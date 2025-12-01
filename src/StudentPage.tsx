import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type { AppUser } from "./hooks/useAuth";
import { useAuth } from "./hooks/useAuth";
import { db } from "./firebase";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc,
    setDoc,
    Timestamp,
} from "firebase/firestore";
import QrScanner from "./QrScanner";
import { useTermOptions, labelFromTerm } from "./terms";
import ProfileModal from "./ProfileModal";
import LoadingSpinner from "./LoadingSpinner";


type StudentPageProps = {
    user: AppUser;
};

type CategoryStat = {
    category: string;
    attendedCount: number; // antall registrerte oppmøter
    totalSessions: number; // antall timer i 'times' for denne kategorien og terminen
    requiredCount: number | null;
};

// Lokale hjelpe-typer for detaljvisning i modal
type TimeRow = {
    id: string;
    name: string;
    category: string;
    term: number;
    order?: number;
};

type SessionRow = {
    id: string;
    timeId?: string;
    name?: string;
    category?: string;
};

type StatusState = "idle" | "success" | "error";

function StudentPage({ user }: StudentPageProps) {
    const { logout } = useAuth();
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [showProfile, setShowProfile] = useState(false);

    const selectedTerm = user.term ?? 11;

    const [stats, setStats] = useState<CategoryStat[]>([]);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsVersion, setStatsVersion] = useState(0);
    const [scanning, setScanning] = useState(false);

    const { options: termOptions } = useTermOptions();

    // Detaljmodal for gruppe → viser hver time og status (registrert/mangler)
    const [groupModalOpen, setGroupModalOpen] = useState(false);
    const [groupModalCategory, setGroupModalCategory] = useState<string | null>(null);
    const [allTimes, setAllTimes] = useState<TimeRow[]>([]);
    const [attendedByTimeId, setAttendedByTimeId] = useState<Record<string, boolean>>({});

    // Suksess / feil-visning
    const [status, setStatus] = useState<StatusState>("idle");
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [lastSessionName, setLastSessionName] = useState<string | null>(null);

    const inactive =
        user.semesterStatus && user.semesterStatus !== "aktiv";

    const resetToIdle = () => {
        setStatus("idle");
        setStatusMessage(null);
        setLastSessionName(null);
        setCode("");
        setScanning(false);
    };

    const registerAttendance = async (inputCode: string) => {
        if (!inputCode || inputCode.length < 6) return;

        setLoading(true);
        setStatus("idle");
        setStatusMessage(null);

        try {
            const sessionsCol = collection(db, "sessions");
            const qSessions = query(sessionsCol, where("code", "==", inputCode));
            const snap = await getDocs(qSessions);

            if (snap.empty) {
                setStatus("error");
                setStatusMessage("Fant ingen økt med denne koden.");
                setCode("");
                setScanning(false);
                setLoading(false);
                return;
            }

            const sessionDoc = snap.docs[0];
            const sessionData = sessionDoc.data() as any;

            const attRef = doc(
                db,
                "sessions",
                sessionDoc.id,
                "attendance",
                user.uid
            );
            const existing = await getDoc(attRef);

            if (existing.exists()) {
                setStatus("error");
                setStatusMessage("Du er allerede registrert på denne økten.");
                setCode("");
                setScanning(false);
                setLoading(false);
                return;
            }

            await setDoc(attRef, {
                userId: user.uid,
                studentName: user.displayName,
                studentEmail: user.email,
                createdAt: Timestamp.now(),
                status: "present",
            });

            const sessionName = sessionData.name || "økten";
            setLastSessionName(sessionName);
            setStatus("success");
            setStatusMessage(null);
            setScanning(false);
            setCode("");
            setStatsVersion((v) => v + 1);
        } catch (err) {
            console.error(err);
            setStatus("error");
            setStatusMessage("Noe gikk galt ved registrering av oppmøte.");
            setCode("");
            setScanning(false);
        } finally {
            setLoading(false);
        }
    };

    // QR-resultat → trekk ut 6-sifret kode → registrer
    const handleQrResult = (text: string) => {
        if (!text || loading) return;
        const numeric = text.replace(/\D/g, "").slice(0, 6);
        if (numeric.length === 6) {
            setCode(numeric);
            void registerAttendance(numeric);
        }
    };

    // Hent statistikk for studentens termin
    useEffect(() => {
        const loadStats = async () => {
            setStatsLoading(true);

            try {
                const reqCol = collection(db, "requirements");
                const reqQ = query(reqCol, where("term", "==", selectedTerm));
                const reqSnap = await getDocs(reqQ);
                const requirements = reqSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        category: data.category as string,
                        requiredCount: data.requiredCount as number,
                    };
                });

                const sessCol = collection(db, "sessions");
                const sessQ = query(sessCol, where("term", "==", selectedTerm));
                const sessSnap = await getDocs(sessQ);
                const sessions: SessionRow[] = sessSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        timeId: typeof data?.timeId === "string" ? data.timeId : undefined,
                        name: typeof data?.name === "string" ? data.name : undefined,
                        category: typeof data?.category === "string" ? data.category : undefined,
                    } as SessionRow;
                });

                const timesCol = collection(db, "times");
                const timesQ = query(timesCol, where("term", "==", selectedTerm));
                const timesSnap = await getDocs(timesQ);
                const times: TimeRow[] = timesSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        name: data.name as string,
                        category: data.category as string,
                        term: data.term as number,
                        order: typeof data?.order === "number" ? data.order : undefined,
                    } as TimeRow;
                });

                const timesCountMap = new Map<string, number>();
                for (const t of times) {
                    if (!t.category) continue;
                    timesCountMap.set(
                        t.category,
                        (timesCountMap.get(t.category) ?? 0) + 1
                    );
                }

                const attendedMap = new Map<string, number>();
                const attendedByTime: Record<string, boolean> = {};
                for (const s of sessions) {
                    if (!s.category) continue;
                    const attRef = doc(
                        db,
                        "sessions",
                        s.id,
                        "attendance",
                        user.uid
                    );
                    const attSnap = await getDoc(attRef);
                    if (attSnap.exists()) {
                        attendedMap.set(
                            s.category,
                            (attendedMap.get(s.category) ?? 0) + 1
                        );

                        // Marker spesifikk time som oppmøtt hvis mulig
                        if (s.timeId) {
                            attendedByTime[s.timeId] = true;
                        } else if (s.name && s.category) {
                            // Fallback når session mangler timeId: prøv å matche på navn og kategori
                            const match = times.find(
                                (t) => t.category === s.category && t.name === s.name
                            );
                            if (match) attendedByTime[match.id] = true;
                        }
                    }
                }

                const categoryNames = new Set<string>();
                for (const r of requirements) categoryNames.add(r.category);
                for (const s of sessions) if (s.category) categoryNames.add(s.category);
                for (const t of times) if (t.category) categoryNames.add(t.category);

                const statsArr: CategoryStat[] = [];
                categoryNames.forEach((category) => {
                    const req = requirements.find((r) => r.category === category);
                    const requiredCount = req ? req.requiredCount : null;

                    const totalTimesInCategory = timesCountMap.get(category) ?? 0;
                    const attendedCount = attendedMap.get(category) ?? 0;

                    statsArr.push({
                        category,
                        attendedCount,
                        totalSessions: totalTimesInCategory,
                        requiredCount,
                    });
                });

                statsArr.sort((a, b) =>
                    a.category.localeCompare(b.category, "nb-NO", {
                        sensitivity: "base",
                    })
                );

                setStats(statsArr);
                setAllTimes(times);
                setAttendedByTimeId(attendedByTime);
            } catch (err) {
                console.error(err);
                setStats([]);
                setAllTimes([]);
                setAttendedByTimeId({});
            } finally {
                setStatsLoading(false);
            }
        };

        loadStats();
    }, [selectedTerm, user.uid, statsVersion]);

    // Hjelper for sortering av tider i modal: først order, så ledetall i navn, så alfa
    const leadingNumber = (name: string): number => {
        const m = name.match(/^\s*(\d+)/);
        return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
    };

    const modalTimes = useMemo(() => {
        if (!groupModalOpen || !groupModalCategory) return [] as (TimeRow & { attended: boolean })[];
        const list = allTimes
            .filter((t) => t.category === groupModalCategory)
            .map((t) => ({ ...t, attended: !!attendedByTimeId[t.id] }));
        list.sort((a, b) => {
            const ao = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
            if (ao !== 0) return ao;
            const na = leadingNumber(a.name);
            const nb = leadingNumber(b.name);
            if (na !== nb) return na - nb;
            return a.name.localeCompare(b.name, "nb-NO", { sensitivity: "base" });
        });
        return list;
    }, [groupModalOpen, groupModalCategory, allTimes, attendedByTimeId]);

    const openGroupModal = (category: string) => {
        setGroupModalCategory(category);
        setGroupModalOpen(true);
    };
    const closeGroupModal = () => {
        setGroupModalOpen(false);
        setGroupModalCategory(null);
    };

    // Manuell kodeinput → auto når 6 siffer
    const handleCodeChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
        const raw = e.target.value.replace(/\D/g, "");
        const trimmed = raw.slice(0, 6);
        setCode(trimmed);

        if (trimmed.length === 6 && !loading) {
            void registerAttendance(trimmed);
        }
    };

    // Auto-tilbake etter 3 sek (success) / 2 sek (error)
    useEffect(() => {
        if (status === "idle") return;

        const timeoutMs = status === "success" ? 5000 : 5000;
        const t = setTimeout(() => {
            resetToIdle();
        }, timeoutMs);

        return () => clearTimeout(t);
    }, [status]);

    return (
        <>
        <div className="page-card page-card--student">
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
            <h2 style={{ textAlign: "center", marginBottom: "1rem" }}>
                Registrer oppmøte
            </h2>

            {inactive && (
                <p style={{ color: "red", textAlign: "center" }}>
                    Du er markert som "{user.semesterStatus}" dette semesteret. Ingen
                    oppmøtekrav, men du kan fortsatt registrere oppmøte.
                </p>
            )}

            {/* Øvre del: statuskort eller kode/QR */}
            <div
                style={{
                    marginTop: "1rem",
                    textAlign: "center",
                }}
            >
                {status === "success" ? (
                    <>
                        <div
                            style={{
                                fontSize: "4rem",
                                color: "#16a34a",
                                marginBottom: "0.5rem",
                            }}
                        >
                            ✅
                        </div>
                        <h3
                            style={{
                                margin: 0,
                                marginBottom: "0.3rem",
                            }}
                        >
                            Oppmøte registrert
                        </h3>
                        {lastSessionName && (
                            <p
                                style={{
                                    margin: 0,
                                    marginBottom: "1rem",
                                    fontSize: "1rem",
                                    color: "#374151",
                                }}
                            >
                                {lastSessionName}
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={resetToIdle}
                            style={{
                                marginTop: "0.5rem",
                                padding: "0.5rem 1.2rem",
                                borderRadius: "999px",
                                border: "none",
                                background: "#2563eb",
                                color: "white",
                                fontWeight: 500,
                                cursor: "pointer",
                                fontSize: "0.95rem",
                            }}
                        >
                            Registrer en kode til
                        </button>
                    </>
                ) : status === "error" ? (
                    <>
                        <div
                            style={{
                                fontSize: "4rem",
                                color: "#dc2626",
                                marginBottom: "0.5rem",
                            }}
                        >
                            ❌
                        </div>
                        <h3
                            style={{
                                margin: 0,
                                marginBottom: "0.3rem",
                            }}
                        >
                            Kunne ikke registrere oppmøte
                        </h3>
                        {statusMessage && (
                            <p
                                style={{
                                    margin: 0,
                                    marginBottom: "1rem",
                                    fontSize: "0.95rem",
                                    color: "#374151",
                                }}
                            >
                                {statusMessage}
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={resetToIdle}
                            style={{
                                marginTop: "0.5rem",
                                padding: "0.5rem 1.2rem",
                                borderRadius: "999px",
                                border: "none",
                                background: "#6b7280",
                                color: "white",
                                fontWeight: 500,
                                cursor: "pointer",
                                fontSize: "0.95rem",
                            }}
                        >
                            Prøv en kode til
                        </button>
                    </>
                ) : (
                    <>
                        <label
                            style={{
                                display: "block",
                                marginBottom: "0.3rem",
                            }}
                        >
                            6-sifret kode fra lærer
                        </label>
                        <input
                            value={code}
                            onChange={handleCodeChange}
                            maxLength={6}
                            placeholder="482931"
                            style={{
                                padding: "0.5rem 0.8rem",
                                fontSize: "1.2rem",
                                letterSpacing: "0.3em",
                                textAlign: "center",
                                borderRadius: "0.5rem",
                                border: "1px solid #d1d5db",
                                minWidth: "10rem",
                            }}
                        />

                        {loading && <LoadingSpinner />}
                        <br/>

                        <button
                            type="button"
                            onClick={() => setScanning((s) => !s)}
                            style={{
                                marginTop: "1rem",
                                padding: "0.4rem 0.9rem",
                                borderRadius: "999px",
                                border: "1px solid #d1d5db",
                                background: scanning ? "#e5e7eb" : "#f9fafb",
                                cursor: "pointer",
                                fontSize: "0.9rem",
                            }}
                        >
                            {scanning ? "Stopp skanning" : "Skann QR-kode"}
                        </button>

                        {scanning && (
                            <div
                                style={{
                                    marginTop: "0.8rem",
                                    display: "flex",
                                    justifyContent: "center",
                                }}
                            >
                                <div
                                    style={{
                                        width: "260px",
                                        maxWidth: "100%",
                                        borderRadius: "0.75rem",
                                        overflow: "hidden",
                                        border: "1px solid #d1d5db",
                                    }}
                                >
                                    <QrScanner onCode={handleQrResult} />
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <hr style={{ marginTop: "2rem", marginBottom: "1rem" }} />

            <section>
                <h3 style={{textAlign: "center"}}>{labelFromTerm(termOptions, selectedTerm)}</h3>

                {statsLoading ? (
                    <LoadingSpinner />
                ) : stats.length === 0 ? (
                    <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                        Ingen registrerte timer for denne terminen ennå.
                    </p>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                        <tr>
                            <th
                                style={{
                                    textAlign: "left",
                                    borderBottom: "1px solid #e5e7eb",
                                    padding: "0.3rem",
                                }}
                            >
                                Gruppe
                            </th>
                            <th
                                style={{
                                    textAlign: "left",
                                    borderBottom: "1px solid #e5e7eb",
                                    padding: "0.3rem",
                                }}
                            >
                                Registrerte oppmøter
                            </th>
                            <th
                                style={{
                                    textAlign: "left",
                                    borderBottom: "1px solid #e5e7eb",
                                    padding: "0.3rem",
                                }}
                            >
                                Krav
                            </th>
                        </tr>
                        </thead>
                        <tbody>
                        {stats.map((s) => {
                            const metRequirement =
                                s.requiredCount != null &&
                                s.attendedCount >= s.requiredCount;

                            const baseCellStyle: React.CSSProperties = {
                                padding: "0.5rem",
                                borderBottom: "1px solid #f3f4f6",
                                background: metRequirement ? "#dcfce7" : "transparent",
                            };

                            return (
                                <tr
                                    key={s.category}
                                    onClick={() => openGroupModal(s.category)}
                                    title="Klikk for å se detaljer"
                                    style={{ cursor: "pointer" }}
                                >
                                    <td style={baseCellStyle}>
                                        {s.category}
                                    </td>
                                    <td style={baseCellStyle}>
                                        {s.totalSessions > 0
                                            ? `${s.attendedCount}/${s.totalSessions}`
                                            : s.attendedCount}
                                    </td>
                                    <td style={baseCellStyle}>
                                        {s.requiredCount ?? "-"}
                                    </td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                )}
            </section>

            {/* Modal: detaljer for valgt gruppe */}
            {groupModalOpen && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        backgroundColor: "rgba(15,23,42,0.35)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 50,
                    }}
                    onClick={closeGroupModal}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: "420px",
                            backgroundColor: "#ffffff",
                            borderRadius: "1rem",
                            padding: "1rem 1.25rem",
                            boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 style={{ margin: 0 }}>
                                {groupModalCategory ? `Oppmøte i ${groupModalCategory}` : "Oppmøte"}
                            </h3>
                            <button
                                type="button"
                                onClick={closeGroupModal}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    fontSize: "1.2rem",
                                    cursor: "pointer",
                                }}
                                aria-label="Lukk"
                                title="Lukk"
                            >
                                ×
                            </button>
                        </div>

                        {modalTimes.length === 0 ? (
                            <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>
                                Ingen timer er definert i denne gruppen enda.
                            </p>
                        ) : (
                            <ul style={{ listStyle: "none", padding: 0, marginTop: "0.75rem" }}>
                                {modalTimes.map((t) => (
                                    <li
                                        key={t.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "0.35rem 0",
                                            borderBottom: "1px solid #f3f4f6",
                                        }}
                                    >
                                        <span>{t.name}</span>
                                        <span
                                            style={{
                                                display: "inline-block",
                                                padding: "0.15rem 0.5rem",
                                                borderRadius: "999px",
                                                backgroundColor: t.attended ? "#dcfce7" : "#fee2e2",
                                                color: t.attended ? "#166534" : "#991b1b",
                                                fontSize: "0.8rem",
                                            }}
                                        >
                                            {t.attended ? "Registrert" : "Mangler"}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
                            <button
                                type="button"
                                onClick={closeGroupModal}
                                style={{
                                    padding: "0.35rem 0.8rem",
                                    borderRadius: "999px",
                                    border: "1px solid #d1d5db",
                                    background: "#fff",
                                    cursor: "pointer",
                                }}
                            >
                                Lukk
                            </button>
                        </div>
                    </div>
                </div>
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

export default StudentPage;