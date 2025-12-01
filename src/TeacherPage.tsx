import { useEffect, useMemo, useRef, useState } from "react";
import type { AppUser } from "./hooks/useAuth";
import { db } from "./firebase";
import { useAuth } from "./hooks/useAuth";
import {
    collection,
    getDocs,
    addDoc,
    doc,
    onSnapshot,
    Timestamp,
    updateDoc,
    getDoc,
    setDoc,
    query,
    where,
    orderBy,
    limit,
    deleteDoc,
} from "firebase/firestore";
import { QRCodeCanvas } from "qrcode.react";
import LoadingSpinner from "./LoadingSpinner";
import { useTermOptions, labelFromTerm } from "./terms";
import ProfileModal from "./ProfileModal";
import { toast } from "sonner";

type TeacherPageProps = {
    user: AppUser;
};

type TimeDoc = {
    id: string;
    name: string;
    category: string;
    term: number;
};

type SessionDoc = {
    id: string;
    timeId: string;
    name: string;
    category: string;
    term: number;
    code: string;
    teacherId: string;
    createdAt: Timestamp;
    isOpen?: boolean;
    openedAt?: Timestamp;
};

type AttendanceRow = {
    id: string;
    studentName: string | null;
    studentEmail: string | null;
    createdAt?: Timestamp;
};

type StudentUser = {
    id: string;
    name: string | null;
    email: string;
    phone?: string | null;
    term?: number | null;
};

type RecentTime = {
    timeId: string;
    name: string;
    category: string;
    term: number;
    lastAt?: Timestamp;
};

function TeacherPage({ user }: TeacherPageProps) {
    const [times, setTimes] = useState<TimeDoc[]>([]);
    const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
    const [allowedTerms, setAllowedTerms] = useState<number[] | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [activeSession, setActiveSession] = useState<SessionDoc | null>(null);
    const [attendees, setAttendees] = useState<AttendanceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const [students, setStudents] = useState<StudentUser[]>([]);
    const [studentsLoading, setStudentsLoading] = useState(true);
    const [studentSearch, setStudentSearch] = useState("");
    const [showStudentSuggestions, setShowStudentSuggestions] = useState(false);

    // Session countdown (120s) state
    const [remainingSeconds, setRemainingSeconds] = useState<number>(120);

    // Nylig registrerte timer (siste 4 timer)
    const [recentTimes, setRecentTimes] = useState<RecentTime[]>([]);
    const [recentLoading, setRecentLoading] = useState<boolean>(false);

    const sessionRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);


    const { options: termOptions } = useTermOptions();
    const { logout } = useAuth();
    const [showProfile, setShowProfile] = useState(false);

    // Hent alle timer
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const snap = await getDocs(collection(db, "times"));
            const list: TimeDoc[] = snap.docs.map((d) => {
                const data = d.data() as any;
                return {
                    id: d.id,
                    name: data.name,
                    category: data.category,
                    term: data.term,
                };
            });
            setTimes(list);
            setLoading(false);
        };
        load();
    }, []);

    // Hent hvilke terminer læreren har lov til å registrere i
    useEffect(() => {
        const loadAllowed = async () => {
            try {
                const uref = doc(db, "users", user.uid);
                const usnap = await getDoc(uref);
                const data = usnap.exists() ? (usnap.data() as any) : null;
                const terms = Array.isArray(data?.allowedTerms)
                    ? (data.allowedTerms as any[])
                          .map((v) => (typeof v === "number" ? v : parseInt(v, 10)))
                          .filter((v) => !Number.isNaN(v))
                    : [];
                setAllowedTerms(terms);
            } catch (e) {
                console.warn("Kunne ikke hente allowedTerms for lærer:", e);
                setAllowedTerms([]);
            }
        };
        loadAllowed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user.uid]);

    // Beregn hvilke term-alternativer som er tilgjengelige (brukes for auto-fokus-logikk)
    const allowedTermOptions = useMemo(() => {
        if (allowedTerms === null) return termOptions; // ukjent enda
        const set = new Set(allowedTerms ?? []);
        return termOptions.filter((o) => set.has(o.value));
    }, [allowedTerms, termOptions]);

    // Fjernet auto-åpning/auto-fokus på modulvalg for å kreve eksplisitt valg av modul

    // Hent studenter (for manuell registrering) for valgt termin.
    useEffect(() => {
        const loadStudents = async () => {
            if (allowedTerms === null || !selectedTerm) return;

            setStudentsLoading(true);
            try {
                const usersCol = collection(db, "users");
                // Kun studenter i valgt termin
                const qUsers = query(
                    usersCol,
                    where("role", "==", "student"),
                    where("term", "==", selectedTerm)
                );
                const snap = await getDocs(qUsers);

                const list: StudentUser[] = snap.docs.map((d) => {
                    const data = d.data() as any;
                    const displayName =
                        (data?.name && String(data.name)) ||
                        (data?.displayName && String(data.displayName)) ||
                        null;
                    return {
                        id: d.id,
                        name: displayName,
                        email: String(data?.email ?? ""),
                        phone: data?.phone ? String(data.phone) : null,
                        term: typeof data?.term === "number" ? data.term : null,
                    } as StudentUser;
                });
                // Sorter alfabetisk på navn, deretter e-post
                list.sort((a, b) => {
                    const an = (a.name ?? "").toLocaleLowerCase();
                    const bn = (b.name ?? "").toLocaleLowerCase();
                    if (an !== bn) return an.localeCompare(bn, "nb-NO");
                    return a.email.localeCompare(b.email, "nb-NO");
                });
                setStudents(list);
            } catch (err) {
                console.error("Feil ved lasting av studenter:", err);
                setStudents([]);
            } finally {
                setStudentsLoading(false);
            }
        };
        loadStudents();
    }, [allowedTerms, selectedTerm]);

    // Hent nylig registrerte timer (siste 4 timer) for denne læreren
    useEffect(() => {
        void loadRecentSessions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user.uid]);

    const loadRecentSessions = async () => {
        try {
            setRecentLoading(true);
            const cutoffMs = Date.now() - 4 * 60 * 60 * 1000; // 4 timer
            const cutoff = Timestamp.fromMillis(cutoffMs);
            const sessionsCol = collection(db, "sessions");
            let docsList: any[] = [];
            try {
                const q1 = query(
                    sessionsCol,
                    where("teacherId", "==", user.uid),
                    where("createdAt", ">=", cutoff),
                    orderBy("createdAt", "desc"),
                    limit(50)
                );
                const snap = await getDocs(q1);
                docsList = snap.docs;
            } catch (err) {
                // Fallback uten indeks: hent alle for lærer og filtrer lokalt
                const q2 = query(sessionsCol, where("teacherId", "==", user.uid));
                const snap2 = await getDocs(q2);
                docsList = snap2.docs
                    .filter((d) => {
                        const dt = (d.data() as any)?.createdAt as Timestamp | undefined;
                        return dt && dt.toMillis() >= cutoffMs;
                    })
                    .sort((a, b) => {
                        const ta = ((a.data() as any)?.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
                        const tb = ((b.data() as any)?.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
                        return tb - ta;
                    })
                    .slice(0, 50);
            }

            // Dedupliser per timeId (behold nyeste)
            const seen = new Set<string>();
            const result: RecentTime[] = [];
            for (const d of docsList) {
                const data = d.data() as any;
                const tid = String(data?.timeId ?? "");
                if (!tid || seen.has(tid)) continue;
                seen.add(tid);
                result.push({
                    timeId: tid,
                    name: String(data?.name ?? "Ukjent time"),
                    category: String(data?.category ?? ""),
                    term: typeof data?.term === "number" ? data.term : (Number(data?.term) || 0),
                    lastAt: data?.createdAt as Timestamp | undefined,
                });
                if (result.length >= 10) break; // vis maks 10 forskjellige timer
            }
            setRecentTimes(result);
        } catch (e) {
            console.warn("Kunne ikke hente nylige timer:", e);
            setRecentTimes([]);
        } finally {
            setRecentLoading(false);
        }
    };

    // Lytt på attendance for aktiv session
    useEffect(() => {
        if (!activeSession) {
            setAttendees([]);
            return;
        }

        const attCol = collection(db, "sessions", activeSession.id, "attendance");
        const unsub = onSnapshot(attCol, (snap) => {
            const list: AttendanceRow[] = snap.docs
                .map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        studentName: data.studentName ?? null,
                        studentEmail: data.studentEmail ?? null,
                        createdAt: data.createdAt,
                    };
                })
                .sort((a, b) => {
                    const ta = a.createdAt?.toMillis?.() ?? 0;
                    const tb = b.createdAt?.toMillis?.() ?? 0;
                    return ta - tb;
                });
            setAttendees(list);
        });

        return () => unsub();
    }, [activeSession?.id]);

    const timesForTerm = useMemo(
        () => times.filter((t) => t.term === selectedTerm),
        [times, selectedTerm]
    );

    const filteredTimes = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!q) return [];
        return timesForTerm
            .filter((t) => t.name.toLowerCase().includes(q))
            .sort((a, b) =>
                a.name.localeCompare(b.name, "nb-NO", { sensitivity: "base" })
            );
    }, [timesForTerm, searchTerm]);

    // Filtrer studenter for manuell registrering – kun samme termin som aktiv økt
    const filteredStudents = useMemo(() => {
        const q = studentSearch.trim().toLowerCase();
        if (!q || !activeSession) return [];
        const queryHasAt = q.includes("@");
        return students
            .filter((s) => {
                // strengt kun samme termin som aktiv økt
                if (s.term !== activeSession.term) return false;
                const name = String(s.name ?? "").toLowerCase();
                const rawEmail = String(s.email ?? "").toLowerCase();
                const email = queryHasAt ? rawEmail : rawEmail.split("@")[0] ?? rawEmail;
                const phone = String(s.phone ?? "").toLowerCase();
                return (
                    name.includes(q) || email.includes(q) || phone.includes(q)
                );
            })
            .slice(0, 10); // vis maks 10 forslag
    }, [students, studentSearch, activeSession]);

    const startNewSessionForTime = async (timeId: string) => {
        const time = times.find((t) => t.id === timeId);
        if (!time) return;

        // Lukk evt. eksisterende økt
        if (activeSession) {
            const oldRef = doc(db, "sessions", activeSession.id);
            await updateDoc(oldRef, { isOpen: false });
            setActiveSession(null);
        }

        const n = Math.floor(100000 + Math.random() * 900000);
        const code = String(n);

        const sessionsCol = collection(db, "sessions");
        const nowTs = Timestamp.now();
        const docRef = await addDoc(sessionsCol, {
            timeId: time.id,
            name: time.name,
            category: time.category,
            term: time.term,
            code,
            teacherId: user.uid,
            teacherName: user.displayName,
            teacherEmail: user.email,
            createdAt: nowTs,
            isOpen: true,
            openedAt: nowTs,
        });

        const newSession: SessionDoc = {
            id: docRef.id,
            timeId: time.id,
            name: time.name,
            category: time.category,
            term: time.term,
            code,
            teacherId: user.uid,
            createdAt: nowTs,
            isOpen: true,
            openedAt: nowTs,
        };
        setActiveSession(newSession);
        // Oppdater nylig-listen i bakgrunnen
        void loadRecentSessions();
    };

    const handleSuggestionClick = async (time: TimeDoc) => {
        setSearchTerm(time.name);
        setShowSuggestions(false);
        await startNewSessionForTime(time.id);
        // Lukk tastatur på mobil ved å fjerne fokus fra input
        if (searchInputRef.current) {
            searchInputRef.current.blur();
        }
    };

    const handleOpenRecent = async (item: RecentTime) => {
        // Sørg for at valgt termin matcher timens termin (for konsistent filtrering senere)
        setSelectedTerm(item.term);
        setSearchTerm(item.name);
        setShowSuggestions(false);
        await startNewSessionForTime(item.timeId);
    };

    const handleCloseSession = async () => {
        if (!activeSession) return;
        const ref = doc(db, "sessions", activeSession.id);
        const willOpen = !activeSession.isOpen;
        if (willOpen) {
            const nowTs = Timestamp.now();
            await updateDoc(ref, { isOpen: true, openedAt: nowTs } as any);
            setActiveSession({ ...activeSession, isOpen: true, openedAt: nowTs });
            setRemainingSeconds(120);
        } else {
            await updateDoc(ref, { isOpen: false } as any);
            setActiveSession({ ...activeSession, isOpen: false });
        }
    };

    // Listen to active session document for isOpen/openedAt changes
    useEffect(() => {
        if (!activeSession) return;
        const sref = doc(db, "sessions", activeSession.id);
        const unsub = onSnapshot(sref, (snap) => {
            if (!snap.exists()) return;
            const data = snap.data() as any;
            setActiveSession((prev) =>
                prev && prev.id === snap.id
                    ? {
                          ...prev,
                          isOpen: data?.isOpen ?? prev.isOpen,
                          openedAt: data?.openedAt ?? prev.openedAt,
                      }
                    : prev
            );
        });
        return () => unsub();
    }, [activeSession?.id]);

    // Countdown timer effect
    useEffect(() => {
        if (!activeSession || !activeSession.isOpen || !activeSession.openedAt) {
            setRemainingSeconds(0);
            return;
        }
        const openedMs = activeSession.openedAt.toMillis();
        const tick = async () => {
            const now = Date.now();
            const elapsed = Math.floor((now - openedMs) / 1000);
            const left = Math.max(0, 15 - elapsed);
            setRemainingSeconds(left);
            if (left === 0 && activeSession.isOpen) {
                // Auto-close once
                try {
                    await updateDoc(doc(db, "sessions", activeSession.id), { isOpen: false } as any);
                    setActiveSession({ ...activeSession, isOpen: false });
                } catch (e) {
                    // ignore errors; will try again on next user action
                }
            }
        };
        tick();
        const iv = setInterval(tick, 1000);
        return () => clearInterval(iv);
    }, [activeSession?.id, activeSession?.isOpen, activeSession?.openedAt]);

    const formatSeconds = (s: number) => {
        const mm = Math.floor(s / 60)
            .toString()
            .padStart(2, "0");
        const ss = Math.floor(s % 60)
            .toString()
            .padStart(2, "0");
        return `${mm}:${ss}`;
    };

    // Legg til student manuelt i aktiv økt
    const handleAddStudentManually = async (student: StudentUser) => {
        if (!activeSession) return;

        try {
            const attRef = doc(
                db,
                "sessions",
                activeSession.id,
                "attendance",
                student.id
            );
            const existing = await getDoc(attRef);
            if (existing.exists()) {
                toast.error("Studenten er allerede registrert på denne økten.");
                return;
            }

            await setDoc(attRef, {
                userId: student.id,
                studentName: student.name ?? null,
                studentEmail: student.email,
                createdAt: Timestamp.now(),
                status: "present",
                addedManually: true,
                addedBy: user.uid,
            });

            // onSnapshot på attendance vil automatisk oppdatere listen
            setStudentSearch("");
            setShowStudentSuggestions(false);
        } catch (err) {
            console.error(err);
            toast.error("Kunne ikke legge til student manuelt.");
        }
    };

    // Fjern registrert student fra aktiv økt (etter bekreftelse via toast)
    const handleRemoveAttendee = (row: AttendanceRow) => {
        if (!activeSession) return;
        const label = row.studentName || row.studentEmail || "denne studenten";
        toast.warning(`Fjerne ${label} fra økten?`, {
            action: {
                label: "Bekreft",
                onClick: async () => {
                    try {
                        await deleteDoc(doc(db, "sessions", activeSession.id, "attendance", row.id));
                        toast.success("Student fjernet fra økten.");
                    } catch (e) {
                        console.error(e);
                        toast.error("Kunne ikke fjerne studenten.");
                    }
                },
            },
            description: "Trykk bekreft for å fjerne",
        });
    };

    if (loading)
        return (
            <div className="page-card page-card--teacher">
                <LoadingSpinner />
            </div>
        );

    return (
        <>
        <div className="page-card page-card--teacher">
            {/* Topp: navn + min profil + logg ut */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                }}
            >
                <div style={{ fontWeight: 600 }}>
                    {user.displayName || user.email}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                        type="button"
                        onClick={() => setShowProfile(true)}
                        style={{
                            padding: "0.35rem 0.9rem",
                            borderRadius: "999px",
                            border: "1px solid #d1d5db",
                            background: "#ffffff",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                        }}
                    >
                        Min profil
                    </button>
                    <button
                        onClick={logout}
                        type="button"
                        style={{
                            padding: "0.35rem 0.9rem",
                            borderRadius: "999px",
                            border: "1px solid #d1d5db",
                            background: "#ffffff",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                        }}
                    >
                        Logg ut
                    </button>
                </div>
            </div>

            <h2 style={{ textAlign: "center", marginBottom: "2rem" }}>
                Registrer oppmøte
            </h2>

            {/* Termin øverst, time under */}
            <section style={{ marginTop: "1rem", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ marginBottom: "1rem", width: "100%", maxWidth: 520 }}>
                    {(() => {
                        // Bygg liste over valgbare terminer
                        const allowedSet =
                            allowedTerms !== null
                                ? new Set(allowedTerms ?? [])
                                : null; // null = ikke lastet enda → vis alle midlertidig
                        const options = allowedSet
                            ? termOptions.filter((o) => allowedSet.has(o.value))
                            : termOptions;

                        if (options.length === 0) {
                            return (
                                <div
                                    style={{
                                        width: "100%",
                                        padding: "0.6rem 0",
                                        fontSize: "16px",
                                        border: "1px solid #e5e7eb",
                                        borderRadius: "0.5rem",
                                        background: "#f9fafb",
                                        color: "#6b7280",
                                        textAlign: "center",
                                    }}
                                >
                                    Ingen terminer tilgjengelig
                                </div>
                            );
                        }

                        return (
                            <select
                                value={selectedTerm ?? ""}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const val = raw === "" ? null : parseInt(raw, 10);
                                    setSelectedTerm(val);
                                    setSearchTerm("");
                                    setShowSuggestions(false);
                                    setActiveSession(null);
                                    setAttendees([]);
                                    // Etter valg av termin: fokuser time-input for rask skriving (mobil/desktop)
                                    if (val != null) {
                                        setTimeout(() => {
                                            searchInputRef.current?.focus();
                                        }, 0);
                                    }
                                }}
                                style={{ width: "100%", padding: "0.6rem 0.75rem", fontSize: "16px", textAlign: "center" }}
                            >
                                <option value="" disabled>
                                    Velg modul
                                </option>
                                {options.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        );
                    })()}
                </div>

                <div style={{ position: "relative", marginBottom: "0.75rem", width: "100%", maxWidth: 520 }}>
                    <input
                        ref={searchInputRef}
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setShowSuggestions(true);
                        }}
                        onFocus={() => {
                            if (selectedTerm && searchTerm.trim().length > 0) setShowSuggestions(true);
                        }}
                        placeholder={selectedTerm ? "Start å skrive navnet på timen..." : "Velg modul først"}
                        disabled={!selectedTerm}
                        style={{ width: "100%", padding: "0.6rem 0rem", fontSize: "16px", textAlign: "center", opacity: !selectedTerm ? 0.6 : 1 }}
                    />

                    {/* Dropdown-forslag under input */}
                    {showSuggestions && filteredTimes.length > 0 && (
                        <ul
                            style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                right: 0,
                                zIndex: 10,
                                background: "white",
                                border: "1px solid #e5e7eb",
                                borderRadius: "0.5rem",
                                marginTop: "0.2rem",
                                listStyle: "none",
                                padding: 0,
                                maxHeight: "220px",
                                overflowY: "auto",
                                boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
                            }}
                        >
                            {filteredTimes.map((t) => (
                                <li
                                    key={t.id}
                                    onClick={() => handleSuggestionClick(t)}
                                    style={{
                                        padding: "0.4rem 0.6rem",
                                        cursor: "pointer",
                                        borderBottom: "1px solid #f3f4f6",
                                    }}
                                    onMouseDown={(e) => e.preventDefault()} // unngå blur før click
                                >
                                    <div>{t.name}</div>
                                    <div
                                        style={{
                                            fontSize: "0.75rem",
                                            color: "#6b7280",
                                        }}
                                    >
                                        {t.category}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            {/* Nylig registrerte timer (kun når ingen aktiv økt) */}
            {!activeSession && recentTimes.length > 0 && (
                <section style={{ marginTop: "1rem", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: "100%", maxWidth: 520 }}>
                        <h4 style={{ textAlign: "center", marginTop: 0 }}>Nylig registrerte timer</h4>
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                            {recentTimes.map((it) => (
                                <li key={it.timeId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #f3f4f6" }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{it.name}</div>
                                        <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                                            {it.category} · {labelFromTerm(termOptions, it.term)}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleOpenRecent(it)}
                                        style={{ padding: "0.35rem 0.9rem", borderRadius: "999px", border: "none", background: "#16a34a", color: "white", cursor: "pointer" }}
                                    >
                                        Åpne
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            )}

            {activeSession && (
                <section
                    ref={sessionRef}
                    style={{
                        marginTop: "2rem",
                        padding: "1rem",
                        border: "1px solid #e5e7eb",
                        borderRadius: "0.75rem",
                        background: "#f9fafb",
                    }}
                >
                    {/* Termin / time / gruppe sentrert */}
                    <div style={{ textAlign: "center" }}>
                        <h3 style={{ marginTop: 0, marginBottom: "0.25rem" }}>
                            {labelFromTerm(termOptions, activeSession.term)}
                        </h3>
                        <p style={{ margin: 0 }}>
                            <strong>Time:</strong> {activeSession.name}
                        </p>
                        <p style={{ marginTop: "0.2rem" }}>
                            <strong>Gruppe:</strong> {activeSession.category}
                        </p>
                    </div>

                    {/* QR + kode under (blurred if session is closed) */}
                    <div style={{ marginTop: "1rem", position: "relative" }}>
                        <div
                            style={{
                                filter: activeSession.isOpen === false ? "blur(6px)" : "none",
                                pointerEvents: "none",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: "0.5rem",
                            }}
                        >
                            <QRCodeCanvas
                                value={activeSession.code}
                                size={160}
                                includeMargin={true}
                            />
                            <div
                                style={{
                                    fontSize: "2rem",
                                    fontWeight: "bold",
                                    letterSpacing: "0.3em",
                                }}
                            >
                                {activeSession.code}
                            </div>
                        </div>
                        {activeSession.isOpen === false && (
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                <div
                                    style={{
                                        background: "rgba(255,255,255,0.85)",
                                        padding: "0.5rem 0.75rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #e5e7eb",
                                        fontWeight: 600,
                                        color: "#6b7280",
                                    }}
                                >
                                    Økten er lukket
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Manuell registrering av student */}
                    <div style={{ marginTop: "1.5rem" }}>
                        <h4 style={{ textAlign: "center", marginBottom: "0.3rem" }}>
                            Legg til student manuelt
                        </h4>
                        <p
                            style={{
                                fontSize: "0.8rem",
                                color: "#6b7280",
                                textAlign: "center",
                                marginTop: 0,
                                marginBottom: "0.5rem",
                            }}
                        >
                            Brukes dersom en student ikke kan skanne eller skrive inn kode.
                        </p>

                        {studentsLoading && (
                            <div style={{ display: "flex", justifyContent: "center" }}>
                                <LoadingSpinner />
                            </div>
                        )}

                        <div
                            style={{
                                position: "relative",
                                maxWidth: "360px",
                                margin: "0 auto",
                            }}
                        >
                            <input
                                value={studentSearch}
                                onChange={(e) => {
                                    setStudentSearch(e.target.value);
                                    setShowStudentSuggestions(true);
                                }}
                                onFocus={() => {
                                    if (studentSearch.trim().length > 0) {
                                        setShowStudentSuggestions(true);
                                    }
                                }}
                                placeholder={
                                    studentsLoading
                                        ? "Laster studenter..."
                                        : "Søk på navn, e-post eller telefon"
                                }
                                disabled={studentsLoading}
                                style={{
                                    width: "100%",
                                    padding: "0.6rem 0.75rem",
                                    fontSize: "16px",
                                    borderRadius: "0.5rem",
                                    border: "1px solid #d1d5db",
                                    textAlign: "center",
                                }}
                            />

                            {showStudentSuggestions &&
                                filteredStudents.length > 0 && (
                                    <ul
                                        style={{
                                            position: "absolute",
                                            top: "100%",
                                            left: 0,
                                            right: 0,
                                            zIndex: 20,
                                            background: "white",
                                            border: "1px solid #e5e7eb",
                                            borderRadius: "0.5rem",
                                            marginTop: "0.2rem",
                                            listStyle: "none",
                                            padding: 0,
                                            maxHeight: "220px",
                                            overflowY: "auto",
                                            boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
                                        }}
                                    >
                                        {filteredStudents.map((s) => (
                                            <li
                                                key={s.id}
                                                onClick={() => handleAddStudentManually(s)}
                                                style={{
                                                    padding: "0.4rem 0.6rem",
                                                    cursor: "pointer",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                                onMouseDown={(e) => e.preventDefault()}
                                            >
                                                <div>{s.name || "(Uten navn)"}</div>
                                                <div
                                                    style={{
                                                        fontSize: "0.75rem",
                                                        color: "#6b7280",
                                                    }}
                                                >
                                                    {s.email}
                                                    {s.phone ? ` – ${s.phone}` : ""}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                        </div>
                    </div>

                    {/* Nedtelling over knappen, begge sentrert */}
                    <div
                        style={{
                            marginTop: "1.2rem",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "0.5rem",
                        }}
                    >
                        <div style={{ fontWeight: 600, color: "#111827" }}>
                            {formatSeconds(remainingSeconds)}
                        </div>
                        <button
                            onClick={handleCloseSession}
                            style={{
                                padding: "0.5rem 1.2rem",
                                borderRadius: "999px",
                                border: "none",
                                background: activeSession.isOpen === false ? "#6CE1AB" : "#6CE1AB",
                                color: "black",
                                fontWeight: 500,
                                cursor: "pointer",
                            }}
                        >
                            {activeSession.isOpen === false ? "Åpne økta" : "Lukk økt"}
                        </button>
                    </div>

                    <hr style={{ margin: "1rem 0" }} />

                    <h4>Registrerte studenter</h4>
                    {attendees.length === 0 ? (
                        <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                            Ingen har registrert seg ennå.
                        </p>
                    ) : (
                        <table
                            style={{ width: "100%", borderCollapse: "collapse" }}
                        >
                            <thead>
                            <tr>
                                <th
                                    style={{
                                        textAlign: "left",
                                        borderBottom: "1px solid #e5e7eb",
                                        padding: "0.3rem",
                                    }}
                                >
                                    Navn
                                </th>
                                <th
                                    style={{
                                        textAlign: "left",
                                        borderBottom: "1px solid #e5e7eb",
                                        padding: "0.3rem",
                                    }}
                                >
                                    E-post
                                </th>
                                <th
                                    style={{
                                        textAlign: "left",
                                        borderBottom: "1px solid #e5e7eb",
                                        padding: "0.3rem",
                                    }}
                                >
                                    Tidspunkt
                                </th>
                                <th
                                    style={{
                                        textAlign: "right",
                                        borderBottom: "1px solid #e5e7eb",
                                        padding: "0.3rem",
                                        width: 40,
                                    }}
                                >
                                    
                                </th>
                            </tr>
                            </thead>
                            <tbody>
                            {attendees.map((a) => (
                                <tr key={a.id}>
                                    <td
                                        style={{
                                            padding: "0.3rem",
                                            borderBottom: "1px solid #f3f4f6",
                                        }}
                                    >
                                        {a.studentName || "-"}
                                    </td>
                                    <td
                                        style={{
                                            padding: "0.3rem",
                                            borderBottom: "1px solid #f3f4f6",
                                        }}
                                    >
                                        {a.studentEmail || "-"}
                                    </td>
                                    <td
                                        style={{
                                            padding: "0.3rem",
                                            borderBottom: "1px solid #f3f4f6",
                                            fontSize: "0.8rem",
                                            color: "#6b7280",
                                        }}
                                    >
                                        {a.createdAt
                                            ? new Date(
                                                a.createdAt.toMillis()
                                            ).toLocaleTimeString("no-NO", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                                second: "2-digit",
                                            })
                                            : "-"}
                                    </td>
                                    <td
                                        style={{
                                            padding: "0.3rem",
                                            borderBottom: "1px solid #f3f4f6",
                                            textAlign: "right",
                                        }}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveAttendee(a)}
                                            aria-label="Fjern student fra økten"
                                            title="Fjern student"
                                            style={{
                                                background: "transparent",
                                                border: "none",
                                                cursor: "pointer",
                                                color: "#b91c1c",
                                                padding: "0.15rem",
                                            }}
                                        >
                                            {/* liten rødt kryss ikon */}
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                aria-hidden
                                            >
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </section>
            )}
        </div>
        {showProfile && (
            <ProfileModal
                uid={user.uid}
                role={user.role}
                email={user.email}
                displayName={user.displayName}
                onClose={() => setShowProfile(false)}
            />
        )}
        </>
    );
}

export default TeacherPage;