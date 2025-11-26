import { useEffect, useState } from "react";
import type React from "react";
import type { AppUser } from "./hooks/useAuth";
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

type StudentPageProps = {
    user: AppUser;
};

type CategoryStat = {
    category: string;
    attendedCount: number; // antall registrerte oppmøter
    totalSessions: number; // antall timer i 'times' for denne kategorien og terminen
    requiredCount: number | null;
};

function StudentPage({ user }: StudentPageProps) {
    const [code, setCode] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const selectedTerm = user.term ?? 11;

    const [stats, setStats] = useState<CategoryStat[]>([]);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsVersion, setStatsVersion] = useState(0);
    const [scanning, setScanning] = useState(false);

    const inactive =
        user.semesterStatus && user.semesterStatus !== "aktiv";

    const registerAttendance = async (inputCode: string) => {
        if (!inputCode || inputCode.length < 6) return;

        setMessage(null);
        setLoading(true);

        try {
            const sessionsCol = collection(db, "sessions");
            const qSessions = query(sessionsCol, where("code", "==", inputCode));
            const snap = await getDocs(qSessions);

            if (snap.empty) {
                setMessage("Fant ingen økt med denne koden.");
                setCode("");
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
                setMessage("Du er allerede registrert på denne økten.");
                setCode("");
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

            setMessage(
                `Oppmøte registrert for ${sessionData.name || "økten"}.`
            );
            setCode("");
            setStatsVersion((v) => v + 1);
        } catch (err) {
            console.error(err);
            setMessage("Noe gikk galt ved registrering av oppmøte.");
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
            setScanning(false);
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
                const sessions = sessSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        category: data.category as string | undefined,
                    };
                });

                const timesCol = collection(db, "times");
                const timesQ = query(timesCol, where("term", "==", selectedTerm));
                const timesSnap = await getDocs(timesQ);
                const times = timesSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        category: data.category as string | undefined,
                    };
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
            } catch (err) {
                console.error(err);
                setStats([]);
            } finally {
                setStatsLoading(false);
            }
        };

        loadStats();
    }, [selectedTerm, user.uid, statsVersion]);

    // Manuell kodeinput → auto når 6 siffer
    const handleCodeChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
        const raw = e.target.value.replace(/\D/g, "");
        const trimmed = raw.slice(0, 6);
        setCode(trimmed);

        if (trimmed.length === 6 && !loading) {
            void registerAttendance(trimmed);
        }
    };

    return (
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
            <h2 style={{ textAlign: "center", marginBottom: "1rem" }}>
                Student – registrer oppmøte
            </h2>

            {inactive && (
                <p style={{ color: "red", textAlign: "center" }}>
                    Du er markert som "{user.semesterStatus}" dette semesteret. Ingen
                    oppmøtekrav, men du kan fortsatt registrere oppmøte.
                </p>
            )}

            {/* Sentrert kodefelt + QR-knapp */}
            <div
                style={{
                    marginTop: "1rem",
                    textAlign: "center",
                }}
            >
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
                <p
                    style={{
                        fontSize: "0.8rem",
                        color: "#6b7280",
                        marginTop: "0.4rem",
                    }}
                >
                    Koden registreres automatisk når du har skrevet inn 6 siffer.
                </p>

                <button
                    type="button"
                    onClick={() => setScanning((s) => !s)}
                    style={{
                        marginTop: "0.5rem",
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
            </div>

            {message && (
                <p style={{ marginTop: "1rem", textAlign: "center" }}>{message}</p>
            )}

            <hr style={{ marginTop: "2rem", marginBottom: "1rem" }} />

            <section>
                <h3>Oppmøteoversikt termin {selectedTerm}</h3>

                {statsLoading ? (
                    <p>Laster oppmøte...</p>
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
                                padding: "0.3rem",
                                borderBottom: "1px solid #f3f4f6",
                                background: metRequirement ? "#dcfce7" : "transparent",
                            };

                            return (
                                <tr key={s.category}>
                                    <td style={baseCellStyle}>{s.category}</td>
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
        </div>
    );
}

export default StudentPage;