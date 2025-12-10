import React, {useEffect, useState} from "react";
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
    serverTimestamp,
    updateDoc,
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

    // Lokal visningstilstand for termin og godkjent-status, slik at UI oppdateres umiddelbart
    const [selectedTerm, setSelectedTerm] = useState<number>(user.term ?? 11);
    const [approvedCurrentTerm, setApprovedCurrentTerm] = useState<boolean>(
        user.approvedCurrentTerm ?? false
    );

    const [stats, setStats] = useState<CategoryStat[]>([]);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsVersion, setStatsVersion] = useState(0);
    const [scanning, setScanning] = useState(false);

    const {options: termOptions} = useTermOptions();

    // Dropdown-detaljer per kategori
    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
    const [allTimes, setAllTimes] = useState<TimeRow[]>([]);
    const [attendedByTimeId, setAttendedByTimeId] = useState<Record<string, boolean>>({});
    const [attendedAtByTimeId, setAttendedAtByTimeId] = useState<Record<string, Timestamp | undefined>>({});

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

    // Hold lokal state i sync når user-propen endres (for eksempel ved innlogging)
    useEffect(() => {
        if (typeof user.term === "number") setSelectedTerm(user.term);
        setApprovedCurrentTerm(!!user.approvedCurrentTerm);
    }, [user.term, user.approvedCurrentTerm]);

    // Hent eller opprett stabil anonymisert ID (authUid) for brukeren
    // Lagres i users/{uid}.authUid og i localStorage for raskere tilgang
    const getOrCreateAuthUid = async (): Promise<string> => {
        try {
            const userRef = doc(db, "users", user.uid);
            const snap = await getDoc(userRef);
            const existing = snap.exists() ? (snap.data() as any)?.authUid : null;
            if (typeof existing === "string" && existing.length >= 8) return existing;

            // Fallback: sjekk localStorage for stabil ID per bruker
            const lsKey = `authUid:${user.uid}`;
            let anon = localStorage.getItem(lsKey);
            if (!anon) {
                // Lag en ny base64url-ID (16 byte)
                try {
                    const bytes = new Uint8Array(16);
                    crypto.getRandomValues(bytes);
                    anon = Array.from(bytes)
                        .map((b) => String.fromCharCode(b))
                        .join("");
                    // @ts-ignore
                    anon = btoa(anon).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
                } catch {
                    // Sikkerhets-fallback om crypto ikke er tilgjengelig
                    anon = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
                }
                localStorage.setItem(lsKey, anon);
            }

            // Persistér til Firestore for gjenbruk på andre enheter
            await setDoc(userRef, {authUid: anon}, {merge: true});
            return anon;
        } catch (e) {
            console.warn("Kunne ikke generere/lagre authUid, bruker fallback i minnet.", e);
            return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        }
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

            // Finn studentens nåværende termin tidlig (for å velge riktig økt)
            const currentTerm =
                typeof selectedTerm === "number"
                    ? selectedTerm
                    : typeof user.term === "number"
                        ? user.term
                        : null;

            if (currentTerm == null) {
                setStatus("error");
                setStatusMessage(
                    "Kontoen din mangler tilknytning til en termin. Kontakt lærer/admin for å få satt riktig termin før du registrerer oppmøte."
                );
                setCode("");
                setScanning(false);
                setLoading(false);
                return;
            }

            // Velg økt for studentens termin, og foretrekk en som er åpen
            const sameTermDocs = snap.docs.filter((d) => {
                const data = d.data() as any;
                const termVal = typeof data?.term === "number" ? data.term : Number(data?.term);
                return Number.isFinite(termVal) && termVal === currentTerm;
            });

            if (sameTermDocs.length === 0) {
                const userLabel = labelFromTerm(termOptions, currentTerm);
                setStatus("error");
                setStatusMessage(`Denne koden gjelder ikke for din termin (${userLabel}).`);
                setCode("");
                setScanning(false);
                setLoading(false);
                return;
            }

            const openDocs = sameTermDocs
                .filter((d) => !!((d.data() as any)?.isOpen))
                .sort((a, b) => {
                    const ao = ((a.data() as any)?.openedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
                    const bo = ((b.data() as any)?.openedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
                    return bo - ao; // nyeste først
                });

            const sessionDoc = (openDocs[0] ?? sameTermDocs[0]);
            const sessionData = sessionDoc.data() as any;

            // Sjekk at økten faktisk er åpen
            if (!sessionData?.isOpen) {
                setStatus("error");
                setStatusMessage("Denne økten er lukket eller utløpt. Be underviseren åpne ny kode.");
                setCode("");
                setScanning(false);
                setLoading(false);
                return;
            }

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

            // Etter vellykket registrering: sjekk om oppmøteboken er komplett og aksepter den
            void checkAndSubmitAttendanceBook();
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
                const attendedAtByTime: Record<string, Timestamp | undefined> = {};
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
                        const createdAt = (attSnap.data() as any)?.createdAt as Timestamp | undefined;
                        attendedMap.set(
                            s.category,
                            (attendedMap.get(s.category) ?? 0) + 1
                        );

                        // Marker spesifikk time som oppmøtt hvis mulig
                        if (s.timeId) {
                            attendedByTime[s.timeId] = true;
                            attendedAtByTime[s.timeId] = createdAt;
                        } else if (s.name && s.category) {
                            // Fallback når session mangler timeId: prøv å matche på navn og kategori
                            const match = times.find(
                                (t) => t.category === s.category && t.name === s.name
                            );
                            if (match) {
                                attendedByTime[match.id] = true;
                                attendedAtByTime[match.id] = createdAt;
                            }
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
                setAttendedAtByTimeId(attendedAtByTime);
            } catch (err) {
                console.error(err);
                setStats([]);
                setAllTimes([]);
                setAttendedByTimeId({});
                setAttendedAtByTimeId({});
            } finally {
                setStatsLoading(false);
            }
        };

        loadStats();
    }, [selectedTerm, user.uid, statsVersion]);

    // Hjelper for sortering av tider i dropdown: først order, så ledetall i navn, så alfa
    const leadingNumber = (name: string): number => {
        const m = name.match(/^\s*(\d+)/);
        return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
    };

    const toggleCategory = (category: string) => {
        setExpandedCategories((prev) => ({...prev, [category]: !prev[category]}));
    };

    const formatDate = (ts?: Timestamp): string => {
        if (!ts) return "";
        try {
            return new Date(ts.toMillis()).toLocaleDateString("nb-NO");
        } catch {
            return "";
        }
    };


    // Sjekk om alle påkrevde grupper for denne terminen er fullført, og registrer akseptert bok
    const checkAndSubmitAttendanceBook = async () => {
        try {
            const term = selectedTerm;

            // Hent krav pr kategori for terminen
            const reqSnap = await getDocs(query(collection(db, "requirements"), where("term", "==", term)));
            const requirements = reqSnap.docs.map((d) => d.data() as any) as {
                category: string;
                requiredCount: number
            }[];

            if (!requirements.length) return; // Ingen krav definert → ingen aksept å registrere

            // Finn alle sessions i terminen
            const sessSnap = await getDocs(query(collection(db, "sessions"), where("term", "==", term)));
            const sessions: { id: string; category?: string }[] = sessSnap.docs.map((d) => {
                const data = d.data() as any;
                return {id: d.id, category: typeof data?.category === "string" ? data.category : undefined};
            });

            // Tell opp oppmøte per kategori
            const attendedMap = new Map<string, number>();
            for (const s of sessions) {
                if (!s.category) continue;
                const attRef = doc(db, "sessions", s.id, "attendance", user.uid);
                const a = await getDoc(attRef);
                if (a.exists()) {
                    attendedMap.set(s.category, (attendedMap.get(s.category) ?? 0) + 1);
                }
            }

            // Vurder om alle påkrevde kategorier er oppfylt
            const allFulfilled = requirements.every((r) => {
                const needed = typeof r.requiredCount === "number" ? r.requiredCount : 0;
                if (needed <= 0) return true;
                const have = attendedMap.get(r.category) ?? 0;
                return have >= needed;
            });

            if (!allFulfilled) return;


            // Sørg for authUid (stabil anonym ID for bruker, ikke PII)
            const authUid = await getOrCreateAuthUid();

            // Skriv akseptert bok hvis ikke finnes fra før (unik per authUid+term)
            const accId = `${authUid}_${term}`;
            const accRef = doc(db, "attendanceBook", accId);
            const has = await getDoc(accRef);
            if (has.exists()) return; // Allerede registrert

            await setDoc(accRef, {
                authUid,
                term,
                acceptedBy: "system",
                acceptedTimeStamp: serverTimestamp(),
            });

            // Sett brukerfeltet approvedCurrentTerm = true når terminen godkjennes
            try {
                await updateDoc(doc(db, "users", user.uid), {
                    approvedCurrentTerm: true,
                });
                setApprovedCurrentTerm(true);
            } catch (e) {
                console.warn("Kunne ikke oppdatere approvedCurrentTerm på bruker:", e);
            }
        } catch (e) {
            console.warn("Klarte ikke å registrere akseptert oppmøtebok:", e);
        }
    };

    // Håndter "Start neste semester" → øk term +1, nullstill approvedCurrentTerm
    const handleStartNextSemester = async () => {
        const nextTerm = (selectedTerm ?? 0) + 1;
        try {
            await updateDoc(doc(db, "users", user.uid), {
                term: nextTerm,
                approvedCurrentTerm: false,
            });
        } catch (e) {
            console.warn("Kunne ikke oppdatere bruker ved semesterbytte:", e);
        } finally {
            // Oppdater UI lokalt uansett, for umiddelbar feedback
            setSelectedTerm(nextTerm);
            setApprovedCurrentTerm(false);
            // Trigger ny innlasting av statistikk for ny termin
            setStatsVersion((v) => v + 1);
        }
    };

    const handleGapLife = async () => {
        const nextTerm = 99;
        try {
            await updateDoc(doc(db, "users", user.uid), {
                term: nextTerm,
                approvedCurrentTerm: false,
            });
        } catch (e) {
            console.warn("Kunne ikke oppdatere bruker ved semesterbytte:", e);
        } finally {
            // Oppdater UI lokalt uansett, for umiddelbar feedback
            setSelectedTerm(nextTerm);
            setApprovedCurrentTerm(false);
            // Trigger ny innlasting av statistikk for ny termin
            setStatsVersion((v) => v + 1);
        }
    }

    // Manuell kodeinput (fra OTP-komponenten) → auto når 6 siffer
    const handleCodeChange = (nextValue: string) => {
        const raw = (nextValue || "").replace(/\D/g, "");
        const trimmed = raw.slice(0, 6);
        setCode(trimmed);
        if (trimmed.length === 6 && !loading) {
            void registerAttendance(trimmed);
        }
    };

    // Auto-tilbake etter 3 sek (success) / 2 sek (error) sekunder minutter
    useEffect(() => {
        if (status === "idle") return;

        const timeoutMs = status === "success" ? 4000 : 4000;
        const t = setTimeout(() => {
            resetToIdle();
        }, timeoutMs);

        return () => clearTimeout(t);
    }, [status]);

    return (
        <>
                <div className="card student-card card-top round-corner-top100">
                    <div className="userInfo">
                        <h2 className="whiteTxt">{user.displayName || user.email}</h2>
                        <p className="thinFont opaqueFont whiteTxt">{labelFromTerm(termOptions, selectedTerm)}</p>
                    </div>
                    <img src="/card-man.svg" alt="Student-profile-placeholder"/>
                </div>
                <div className="card student-card card-bottom full-border round-corner-bottom100 ">

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
                            <div className="registered-error">
                                {/* OPPMØTE REGISTERT */}
                                <img src="/error.svg" alt="Error-icon"/>
                                <h3 className="">
                                    Kunne ikke registrere oppmøte
                                </h3>
                                <p className="">{statusMessage ?? "Fant ingen gruppetimer med denne koden. Sjekk at økten er åpen hos underviseren."}</p>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* STANDARD TILSTAND */}
                            <div className="code-input-container">
                                <p className="spacedFont thinFont">
                                    Oppmøtekode fra underviser
                                </p>
                                <OtpInput
                                    value={code}
                                    onChange={handleCodeChange}
                                    disabled={loading}
                                />
                            </div>

                            <img src="/qrscan.svg" alt="QR-code-icon" className="qr-code-icon"/>
                            <br />
                            <button
                                type="button"
                                onClick={() => setScanning(true)}
                                className="button-colorless fontUnderline boldFont qr-code-button"
                            >
                                Scan QR-kode
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
                                        <div style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            marginBottom: "0.5rem"
                                        }}>
                                            <h3 style={{margin: 0}}>Skann QR-kode</h3>
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
                                        <div style={{
                                            borderRadius: "0.75rem",
                                            overflow: "hidden",
                                            border: "1px solid #e5e7eb"
                                        }}>
                                            <ErrorBoundary
                                                onError={(error) => handleScannerError(error)}
                                                resetKey={scanning}
                                            >
                                                <QrScanner onCode={handleQrResult} onError={handleScannerError}/>
                                            </ErrorBoundary>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
            </div>
                {approvedCurrentTerm && (
                    <div className="card approved-term-card full-border round-corners-whole100 ">
                        <h2 className="boldFont">Godkjent</h2>
                        <p className="thinFont opaqueFont">
                            Bra jobba! Kravene for {labelFromTerm(termOptions, selectedTerm).toLowerCase()} er oppnådd.
                            Lykke
                            til på eksamen!
                        </p>
                        <button
                            id="start-next-semester-button"
                            className="button button-black button-fullwidth field-height-100 round-corners-whole50"
                            onClick={handleStartNextSemester}
                        >
                            Start neste semester
                        </button>
                        <button
                           id = "gap-life-button"
                            className="button button-colorless fontUnderline boldFont"
                           onClick={handleGapLife}
                        >Har innvilget permisjon
                        </button>
                    </div>
                )}
                <div className="card round-corners-whole100 student-overview-card">
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
                                <p className="thinFont opaqueFont">Her finner du alle fullførte og fremtidige
                                    oppmøter.
                                </p>
                                <table className="table-container">
                                    <tbody>
                                    {stats.map((s) => {
                                        const metRequirement =
                                            s.requiredCount != null &&
                                            s.attendedCount >= s.requiredCount;

                                        return (
                                            <React.Fragment key={s.category}>
                                                <tr
                                                    onClick={() => toggleCategory(s.category)}
                                                    className="main-table-overview-row"
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
                                                {expandedCategories[s.category] && (
                                                    // Dropdown-detaljer per time i kategorien
                                                    <tr>
                                                        <td colSpan={4} className="detail-cell">
                                                            <div className="subtable-wrapper">
                                                                <table className="subtable">
                                                                    <tbody>
                                                                    {allTimes
                                                                        .filter((t) => t.category === s.category)
                                                                        .sort((a, b) => {
                                                                            const ao = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
                                                                            if (ao !== 0) return ao;
                                                                            const na = leadingNumber(a.name);
                                                                            const nb = leadingNumber(b.name);
                                                                            if (na !== nb) return na - nb;
                                                                            return a.name.localeCompare(b.name, "nb-NO", {sensitivity: "base"});
                                                                        })
                                                                        .map((t) => {
                                                                            const attended = !!attendedByTimeId[t.id];
                                                                            const attendedAt = attendedAtByTimeId[t.id];
                                                                            return (
                                                                                <tr key={`detail-${s.category}-${t.id}`}>
                                                                                    <td className="subtable-icon-cell">
                                                                                        {attended ? (
                                                                                            <img src="/check-white.svg" alt="Checkmark-icon"/>
                                                                                        ) : (
                                                                                            <></>
                                                                                        )}
                                                                                    </td>
                                                                                    <td className="class-overview thinFont smal subtable-name-cell">{t.name}</td>
                                                                                    <td className="smallText opaqueFont subtable-date-cell">{attended ? formatDate(attendedAt) : ""}</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                    </tbody>
                                </table>
                            </>
                        )}
                    </section>
                </div>
            </>
            );
            }

export default StudentPage;