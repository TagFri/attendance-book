import {useEffect, useMemo, useState} from "react";
import type React from "react";
import type {AppUser} from "./hooks/useAuth";
import {db} from "./firebase";
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
import ErrorBoundary from "./ErrorBoundary";
import {useTermOptions, labelFromTerm} from "./terms";
import LoadingSpinner from "./LoadingSpinner";
import OtpInput from "./OtpInput";

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

function StudentPage({user}: StudentPageProps) {

    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);


    const selectedTerm = user.term ?? 11;

    const [stats, setStats] = useState<CategoryStat[]>([]);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsVersion, setStatsVersion] = useState(0);
    const [scanning, setScanning] = useState(false);

    const {options: termOptions} = useTermOptions();

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
            // Lukk QR-modalen når vi har funnet en gyldig kode
            setScanning(false);
            void registerAttendance(numeric);
        }
    };

    // Håndter feil fra QR-skanner
    const handleScannerError = (err: unknown) => {
        console.warn("QR-skanner-feil:", err);
        setScanning(false);
        setStatus("error");
        setStatusMessage(
            "Kunne ikke starte kamera. Sjekk kameratilgang i nettleseren eller skriv inn oppmøtekoden manuelt."
        );
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
            .map((t) => ({...t, attended: !!attendedByTimeId[t.id]}));
        list.sort((a, b) => {
            const ao = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
            if (ao !== 0) return ao;
            const na = leadingNumber(a.name);
            const nb = leadingNumber(b.name);
            if (na !== nb) return na - nb;
            return a.name.localeCompare(b.name, "nb-NO", {sensitivity: "base"});
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

    // Manuell kodeinput (fra OTP-komponenten) → auto når 6 siffer
    const handleCodeChange = (nextValue: string) => {
        const raw = (nextValue || "").replace(/\D/g, "");
        const trimmed = raw.slice(0, 6);
        setCode(trimmed);
        if (trimmed.length === 6 && !loading) {
            void registerAttendance(trimmed);
        }
    };

    // Auto-tilbake etter 3 sek (success) / 2 sek (error)
    useEffect(() => {
        if (status === "idle") return;

        const timeoutMs = status === "success" ? 10000 : 2000;
        const t = setTimeout(() => {
            resetToIdle();
        }, timeoutMs);

        return () => clearTimeout(t);
    }, [status]);

    return (
        <>
            <div className="card student-card student-card-top round-border-top">
                <div className="studentInfo">
                    <h2>{user.displayName || user.email}</h2>
                    <p className="thinFont smallText opaqueFont">{labelFromTerm(termOptions, selectedTerm)}</p>
                </div>
                <img src="/card-man.svg" alt="Student-profile-placeholder"/>
            </div>
            <div className="card student-card student-card-bottom round-border-bottom">


                {status === "success" ? (
                    <>
                        <div className="registered-sucsess">
                            {/* OPPMØTE REGISTERT */}
                            <img src="/registered.svg" alt="Registered-icon"/>
                            <h3 className="">
                                Oppmøte registrert
                            </h3>
                            {lastSessionName && (
                                <p className="">
                                    {lastSessionName}
                                </p>
                            )}
                        </div>
                    </>
                ) : status === "error" ? (
                    <>
                        {/* OPPMØTE IKKE REGISTERT */}
                        <div className="">
                            ❌
                        </div>
                        <h3 className="">
                            Kunne ikke registrere oppmøte
                        </h3>
                        {statusMessage && (
                            <p className="m-0 mb-1 fs-0_95 text-gray-700">
                                {statusMessage}
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        {/* STANDARD TILSTAND */}
                        <div className="code-input-container">
                            <p className="spacedFont thinFont">
                                Oppmøtekode fra lærer
                            </p>
                            <OtpInput
                                value={code}
                                onChange={handleCodeChange}
                                disabled={loading}
                            />
                        </div>

                        <img src="/qrscan.svg" alt="QR-code-icon" className="qr-code-icon"/>

                        <br/>

                        <button
                            type="button"
                            onClick={() => setScanning(true)}
                            className="button-colorless fontUnderline boldFont QRbutton"
                        >
                            Skann QR-kode
                        </button>

                        {scanning && (
                            <div
                                style={{
                                    position: "fixed",
                                    inset: 0,
                                    backgroundColor: "rgba(15,23,42,0.35)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    zIndex: 60,
                                }}
                                onClick={() => setScanning(false)}
                                role="dialog"
                                aria-modal="true"
                                aria-label="Skann QR-kode"
                            >
                                <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        width: "100%",
                                        maxWidth: "480px",
                                        backgroundColor: "#ffffff",
                                        borderRadius: "1rem",
                                        padding: "1rem 1.25rem",
                                        boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                                        <h3 style={{ margin: 0 }}>Skann QR-kode</h3>
                                        <button
                                            type="button"
                                            onClick={() => setScanning(false)}
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
                                    <div style={{ borderRadius: "0.75rem", overflow: "hidden", border: "1px solid #e5e7eb" }}>
                                        <ErrorBoundary
                                            onError={(error) => handleScannerError(error)}
                                            resetKey={scanning}
                                        >
                                            <QrScanner onCode={handleQrResult} onError={handleScannerError} />
                                        </ErrorBoundary>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}


            </div>
            <div className="card round-corners-full approved-term-card">
                <h2>Godkjent</h2>
                <p className="thinFont opaqueFont">
                    Bra jobba! Kravene for {labelFromTerm(termOptions, selectedTerm).toLowerCase()} er oppnådd. Lykke til på eksamen!
                </p>
                <button className="btn button-primary button-black button-next-semester">Start neste semester</button>
                <button className="button-primary button-colorless fontUnderline">Innvilget permisjon</button>
            </div>
            <div className="card round-corners-full student-overview-card">

                {inactive && (
                    <p className="text-red text-center">
                        Du er markert som "{user.semesterStatus}" dette semesteret. Ingen
                        oppmøtekrav, men du kan fortsatt registrere oppmøte.
                    </p>
                )}

                {/* Øvre del: statuskort eller kode/QR */}

                <section>
                    {statsLoading ? (
                        <LoadingSpinner/>
                    ) : stats.length === 0 ? (
                        <p className="fs-0_9 text-gray-500">
                            Ingen registrerte timer for denne terminen ennå.
                        </p>
                    ) : (
                        <>
                            <h2>Min oppmøtebok</h2>
                            <p className="thinFont opaqueFont">Her finner du alle fullførte<br/> og fremtidige oppmøter.
                            </p>
                            <table className="table-container">
                                <tbody>
                                {stats.map((s) => {
                                    const metRequirement =
                                        s.requiredCount != null &&
                                        s.attendedCount >= s.requiredCount;

                                    return (
                                        <tr
                                            key={s.category}
                                            onClick={() => openGroupModal(s.category)}
                                        >
                                            <td className="requirement-meet-icon">
                                                {metRequirement ? (
                                                    <img src="/check-white.svg" alt="Checkmark-icon"/>
                                                ) : (
                                                    <></>
                                                )}
                                            </td>
                                            <td className="class-overview thinFont smal">
                                                {s.category}
                                            </td>
                                            <td className="spacedFont">
                                                {s.totalSessions > 0
                                                    ? `${s.attendedCount}/${s.totalSessions}`
                                                    : s.attendedCount}
                                            </td>
                                            <td className="required-classes">
                                                {s.requiredCount ?? "-"}
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                            <h2>Godkjent</h2>
                            <p className="thinFont opaqueFont">
                                Bra jobba! Kravene for {labelFromTerm(termOptions, selectedTerm).toLowerCase()} er oppnådd. Lykke til på eksamen!
                            </p>
                        </>
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
                            <div style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center"
                            }}>
                                <h3 style={{margin: 0}}>
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
                                <p style={{fontSize: "0.9rem", color: "#6b7280"}}>
                                    Ingen timer er definert i denne gruppen enda.
                                </p>
                            ) : (
                                <ul style={{listStyle: "none", padding: 0, marginTop: "0.75rem"}}>
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

                            <div style={{display: "flex", justifyContent: "flex-end", marginTop: "0.75rem"}}>
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
        </>
    );
}

export default StudentPage;