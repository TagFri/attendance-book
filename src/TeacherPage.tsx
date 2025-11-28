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
} from "firebase/firestore";
import { QRCodeCanvas } from "qrcode.react";
import { TERM_OPTIONS, termLabel } from "./termConfig";

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
    term?: number | null;
};

function TeacherPage({ user }: TeacherPageProps) {
    const [times, setTimes] = useState<TimeDoc[]>([]);
    const [selectedTerm, setSelectedTerm] = useState<number>(user.term ?? 11);
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

    const sessionRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const autoFocusOnceRef = useRef(false);
    const termSelectRef = useRef<HTMLSelectElement | null>(null);
    const autoOpenTermOnceRef = useRef(false);


    const getTermLabel = (term: number | null | undefined) => {
        if (term == null) return "";
        const opt = TERM_OPTIONS.find((o) => o.value === term);
        return opt ? opt.label : term.toString();
    };

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

                // Sett valgt termin basert på tillatte terminer
                if (terms.length > 0) {
                    if (user.term && terms.includes(user.term)) {
                        setSelectedTerm(user.term);
                    } else {
                        setSelectedTerm(terms[0]);
                    }
                }
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
        if (allowedTerms === null) return TERM_OPTIONS; // ukjent enda
        const set = new Set(allowedTerms ?? []);
        return TERM_OPTIONS.filter((o) => set.has(o.value));
    }, [allowedTerms]);

    // Auto-fokus på time-input når det kun finnes én termin (statisk visning)
    useEffect(() => {
        if (autoFocusOnceRef.current) return;
        if (allowedTerms === null) return; // avvent til vi vet
        if (allowedTermOptions.length === 1) {
            autoFocusOnceRef.current = true;
            // liten delay for å sikre at input er mountet og klar (mobil)
            setTimeout(() => {
                searchInputRef.current?.focus();
            }, 0);
        }
    }, [allowedTerms, allowedTermOptions.length]);

    // Auto-åpne termin-dropdown når lærer logger inn og har flere valg
    useEffect(() => {
        if (autoOpenTermOnceRef.current) return;
        if (allowedTerms === null) return; // vent til vi vet
        if (allowedTermOptions.length > 1) {
            autoOpenTermOnceRef.current = true;
            setTimeout(() => {
                const sel = termSelectRef.current;
                if (!sel) return;
                // Forsøk moderne API hvis tilgjengelig
                // @ts-ignore
                if (typeof sel.showPicker === "function") {
                    // @ts-ignore
                    sel.showPicker();
                } else {
                    sel.focus();
                    try {
                        sel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                    } catch (e) {
                        // fallback: klikk
                        sel.click();
                    }
                }
            }, 50);
        }
    }, [allowedTerms, allowedTermOptions.length]);

    // Hent studenter (for manuell registrering) iht. Plan B-regler.
    // Lærer kan lese studenter hvis student.term er i lærerens allowedTerms
    // eller når student.term er null. Derfor filtrerer vi i spørringen.
    useEffect(() => {
        const loadStudents = async () => {
            if (allowedTerms === null) return; // vent til vi vet

            setStudentsLoading(true);
            try {
                const usersCol = collection(db, "users");
                const snaps: Array<Awaited<ReturnType<typeof getDocs>>> = [];

                const terms = (Array.isArray(allowedTerms)
                    ? allowedTerms.filter((v) => typeof v === "number")
                    : []) as number[];

                if (terms.length > 0) {
                    for (let i = 0; i < terms.length; i += 10) {
                        const batch = terms.slice(i, i + 10);
                        const qUsers = query(
                            usersCol,
                            where("role", "==", "student"),
                            where("term", "in", batch)
                        );
                        const snap = await getDocs(qUsers);
                        snaps.push(snap);
                    }
                }

                // Også: studenter uten term
                const qNull = query(
                    usersCol,
                    where("role", "==", "student"),
                    where("term", "==", null)
                );
                const snapNull = await getDocs(qNull);
                snaps.push(snapNull);

                const seen = new Set<string>();
                const list: StudentUser[] = [];
                for (const s of snaps) {
                    s.docs.forEach((d) => {
                        if (seen.has(d.id)) return;
                        seen.add(d.id);
                        const data = d.data() as any;
                        list.push({
                            id: d.id,
                            name:
                                (data.name as string | undefined) ||
                                (data.displayName as string | undefined) ||
                                null,
                            email: data.email as string,
                            term: data.term ?? null,
                        });
                    });
                }

                setStudents(list);
            } catch (err) {
                console.error("Feil ved lasting av studenter:", err);
                setStudents([]);
            } finally {
                setStudentsLoading(false);
            }
        };
        loadStudents();
    }, [allowedTerms]);

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

    // Scroll til økt-kort når vi får ny aktiv session
    useEffect(() => {
        if (activeSession && sessionRef.current) {
            sessionRef.current.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        }
    }, [activeSession]);

    const timesForTerm = useMemo(
        () => times.filter((t) => t.term === selectedTerm),
        [times, selectedTerm]
    );

    const filteredTimes = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!q) return [];
        return timesForTerm
            .filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.category.toLowerCase().includes(q)
            )
            .sort((a, b) =>
                a.name.localeCompare(b.name, "nb-NO", { sensitivity: "base" })
            );
    }, [timesForTerm, searchTerm]);

    // Filtrer studenter for manuell registrering (samme termin som økten hvis mulig)
    const filteredStudents = useMemo(() => {
        const q = studentSearch.trim().toLowerCase();
        if (!q || !activeSession) return [];
        return students
            .filter((s) => {
                // filtrer helst til samme termin, men ta med de uten term satt
                if (s.term && s.term !== activeSession.term) return false;
                const name = (s.name ?? "").toLowerCase();
                const email = s.email.toLowerCase();
                return name.includes(q) || email.includes(q);
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
        const docRef = await addDoc(sessionsCol, {
            timeId: time.id,
            name: time.name,
            category: time.category,
            term: time.term,
            code,
            teacherId: user.uid,
            teacherName: user.displayName,
            teacherEmail: user.email,
            createdAt: Timestamp.now(),
            isOpen: true,
        });

        const newSession: SessionDoc = {
            id: docRef.id,
            timeId: time.id,
            name: time.name,
            category: time.category,
            term: time.term,
            code,
            teacherId: user.uid,
            createdAt: Timestamp.now(),
        };
        setActiveSession(newSession);
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

    const handleCloseSession = async () => {
        if (!activeSession) return;
        const ref = doc(db, "sessions", activeSession.id);
        await updateDoc(ref, { isOpen: false });
        setActiveSession(null);
        setAttendees([]);
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
                alert("Studenten er allerede registrert på denne økten.");
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
            alert("Kunne ikke legge til student manuelt.");
        }
    };

    if (loading) return <div className="page-card page-card--teacher">Laster lærerdata...</div>;

    return (
        <div className="page-card page-card--teacher">
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
                            ? TERM_OPTIONS.filter((o) => allowedSet.has(o.value))
                            : TERM_OPTIONS;

                        if (options.length === 0) {
                            return (
                                <div
                                    style={{
                                        width: "100%",
                                        padding: "0.6rem 0.75rem",
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

                        if (options.length <= 1) {
                            const only = options[0] ?? TERM_OPTIONS.find((o) => o.value === selectedTerm);
                            // Vis statisk tekst dersom bare én termin er tillatt
                            return (
                                <div
                                    style={{
                                        width: "100%",
                                        padding: "0.6rem 0.75rem",
                                        fontSize: "16px",
                                        border: "1px solid #e5e7eb",
                                        borderRadius: "0.5rem",
                                        background: "#f9fafb",
                                        textAlign: "center",
                                    }}
                                >
                                    {only ? only.label : termLabel(selectedTerm)}
                                </div>
                            );
                        }

                        return (
                            <select
                                ref={termSelectRef}
                                value={selectedTerm}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    setSelectedTerm(val);
                                    setSearchTerm("");
                                    setShowSuggestions(false);
                                    setActiveSession(null);
                                    setAttendees([]);
                                    // Etter valg av termin: fokuser time-input for rask skriving (mobil/desktop)
                                    setTimeout(() => {
                                        searchInputRef.current?.focus();
                                    }, 0);
                                }}
                                style={{ width: "100%", padding: "0.6rem 0.75rem", fontSize: "16px", textAlign: "center" }}
                            >
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
                            if (searchTerm.trim().length > 0) setShowSuggestions(true);
                        }}
                        placeholder="Start å skrive navnet på timen..."
                        style={{ width: "100%", padding: "0.6rem 0rem", fontSize: "16px", textAlign: "center" }}
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
                            {termLabel(activeSession.term)}
                        </h3>
                        <p style={{ margin: 0 }}>
                            <strong>Time:</strong> {activeSession.name}
                        </p>
                        <p style={{ marginTop: "0.2rem" }}>
                            <strong>Gruppe:</strong> {activeSession.category}
                        </p>
                    </div>

                    {/* QR + kode under */}
                    <div
                        style={{
                            marginTop: "1rem",
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
                                        : "Søk på navn eller e-post"
                                }
                                disabled={studentsLoading}
                                style={{
                                    width: "100%",
                                    padding: "0.4rem",
                                    fontSize: "14px",
                                    borderRadius: "0.5rem",
                                    border: "1px solid #d1d5db",
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
                                                    {s.term && ` – termin ${s.term}`}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                        </div>
                    </div>

                    {/* Lukk økt-knapp */}
                    <div
                        style={{
                            marginTop: "1.2rem",
                            display: "flex",
                            justifyContent: "center",
                        }}
                    >
                        <button
                            onClick={handleCloseSession}
                            style={{
                                padding: "0.5rem 1.2rem",
                                borderRadius: "999px",
                                border: "none",
                                background: "#dc2626",
                                color: "white",
                                fontWeight: 500,
                                cursor: "pointer",
                            }}
                        >
                            Lukk økt
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
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </section>
            )}
        </div>
    );
}

export default TeacherPage;