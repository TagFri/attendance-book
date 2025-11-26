import { useEffect, useMemo, useState } from "react";
import type { AppUser } from "./hooks/useAuth";
import { db } from "./firebase";
import {
    collection,
    getDocs,
    addDoc,
    doc,
    onSnapshot,
    Timestamp,
    updateDoc,
} from "firebase/firestore";
import { QRCodeCanvas } from "qrcode.react";

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

function TeacherPage({ user }: TeacherPageProps) {
    const [times, setTimes] = useState<TimeDoc[]>([]);
    const [selectedTerm, setSelectedTerm] = useState<number>(user.term ?? 11);
    const [searchTerm, setSearchTerm] = useState("");
    const [activeSession, setActiveSession] = useState<SessionDoc | null>(null);
    const [attendees, setAttendees] = useState<AttendanceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [showSuggestions, setShowSuggestions] = useState(false);

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
            .filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    t.category.toLowerCase().includes(q)
            )
            .sort((a, b) =>
                a.name.localeCompare(b.name, "nb-NO", { sensitivity: "base" })
            );
    }, [timesForTerm, searchTerm]);

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
    };

    const handleCloseSession = async () => {
        if (!activeSession) return;
        const ref = doc(db, "sessions", activeSession.id);
        await updateDoc(ref, { isOpen: false });
        setActiveSession(null);
        setAttendees([]);
    };

    const handleTermChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
        const val = parseInt(e.target.value, 10);
        if (Number.isNaN(val)) return;
        if (val < 1 || val > 12) return;

        setSelectedTerm(val);
        setSearchTerm("");
        setShowSuggestions(false);
        setActiveSession(null);
        setAttendees([]);
    };

    if (loading) return <p>Laster lærerdata...</p>;

    return (
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
            <h2 style={{ textAlign: "center", marginBottom: "1rem" }}>
                Lærer – oppmøte
            </h2>

            {/* Termin + time på horisontal linje */}
            <section style={{ marginTop: "1rem" }}>
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "1rem",
                        alignItems: "flex-end",
                    }}
                >
                    <div style={{ minWidth: "120px" }}>
                        <label>Termin</label>
                        <br />
                        <input
                            type="number"
                            min={1}
                            max={12}
                            value={selectedTerm}
                            onChange={handleTermChange}
                            style={{ width: "100%", padding: "0.4rem" }}
                        />
                    </div>

                    <div style={{ flex: 1, position: "relative" }}>
                        <label>Time (søk f.eks. "ort")</label>
                        <br />
                        <input
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setShowSuggestions(true);
                            }}
                            onFocus={() => {
                                if (searchTerm.trim().length > 0) setShowSuggestions(true);
                            }}
                            placeholder="Start å skrive navnet på timen..."
                            style={{ width: "100%", padding: "0.4rem" }}
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
                                            {t.category} – termin {t.term}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </section>

            {activeSession && (
                <section
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
                            Termin {activeSession.term}
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

                    {/* Lukk økt-knapp, sentrert, avrundet, farge */}
                    <div
                        style={{
                            marginTop: "1rem",
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