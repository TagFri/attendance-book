import type React from "react";
import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import StudentPage from "./StudentPage";
import TeacherPage from "./TeacherPage";
import AdminPage from "./AdminPage";

const outerStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f3f4f6",
    fontFamily:
        "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const cardStyle: React.CSSProperties = {
    background: "white",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
    width: "100%",
    maxWidth: "960px",
};

function App() {
    const { user, loading, login, register, logout } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError(null);

        if (!email || !password) {
            setAuthError("Fyll inn både e-post og passord.");
            return;
        }

        setSubmitting(true);
        try {
            if (isRegisterMode) {
                await register(email.trim(), password);
            } else {
                await login(email.trim(), password);
            }
            // onAuthStateChanged tar over etter dette
        } catch (err: any) {
            console.error(err);
            let msg = "Kunne ikke logge inn.";
            if (err?.code === "auth/user-not-found") {
                msg = "Bruker finnes ikke. Prøv å registrere deg først.";
            } else if (err?.code === "auth/wrong-password") {
                msg = "Feil passord.";
            } else if (err?.code === "auth/email-already-in-use") {
                msg = "E-postadressen er allerede registrert.";
            } else if (err?.code === "auth/weak-password") {
                msg = "Passordet er for svakt (min. 6 tegn).";
            }
            setAuthError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div style={outerStyle}>
                <div style={cardStyle}>
                    <p>Laster...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div style={outerStyle}>
                <div style={{ ...cardStyle, maxWidth: "420px" }}>
                    <h1 style={{ marginBottom: "0.5rem", textAlign: "center"}}>Oppmøteregistrering</h1>

                    <form onSubmit={handleSubmit}>
                        <div style={{ marginBottom: "0.75rem" }}>
                            <label
                                style={{
                                    display: "block",
                                    fontSize: "0.85rem",
                                    marginBottom: "0.2rem",
                                }}
                            >
                                E-post
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="fornavn.etternavn@uio.no"
                                style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    borderRadius: "0.5rem",
                                    border: "1px solid #d1d5db",
                                }}
                            />
                        </div>

                        <div style={{ marginBottom: "0.75rem" }}>
                            <label
                                style={{
                                    display: "block",
                                    fontSize: "0.85rem",
                                    marginBottom: "0.2rem",
                                }}
                            >
                                Passord
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Minst 6 tegn"
                                style={{
                                    width: "100%",
                                    padding: "0.5rem",
                                    borderRadius: "0.5rem",
                                    border: "1px solid #d1d5db",
                                }}
                            />
                        </div>

                        {authError && (
                            <p style={{ color: "red", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                                {authError}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={submitting}
                            style={{
                                width: "100%",
                                padding: "0.6rem 1rem",
                                borderRadius: "999px",
                                border: "none",
                                background: "#2563eb",
                                color: "white",
                                fontWeight: 500,
                                cursor: "pointer",
                                marginBottom: "0.5rem",
                            }}
                        >
                            {submitting
                                ? isRegisterMode
                                    ? "Registrerer..."
                                    : "Logger inn..."
                                : isRegisterMode
                                    ? "Registrer bruker"
                                    : "Logg inn"}
                        </button>
                    </form>

                    <div
                        style={{
                            marginTop: "0.5rem",
                            fontSize: "0.85rem",
                            textAlign: "center",
                        }}
                    >
                        {isRegisterMode ? (
                            <>
                                Har du allerede en bruker?{" "}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsRegisterMode(false);
                                        setAuthError(null);
                                    }}
                                    style={{
                                        border: "none",
                                        background: "transparent",
                                        color: "#2563eb",
                                        cursor: "pointer",
                                        textDecoration: "underline",
                                        padding: 0,
                                    }}
                                >
                                    Logg inn
                                </button>
                            </>
                        ) : (
                            <>
                                Ny bruker?{" "}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsRegisterMode(true);
                                        setAuthError(null);
                                    }}
                                    style={{
                                        border: "none",
                                        background: "transparent",
                                        color: "#2563eb",
                                        cursor: "pointer",
                                        textDecoration: "underline",
                                        padding: 0,
                                    }}
                                >
                                    Registrer deg
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Innlogget
    return (
        <div style={outerStyle}>
            <div style={cardStyle}>
                <header
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "1rem",
                    }}
                >
                    <div>
                        <div>{user.displayName || user.email}</div>
                        <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                            Rolle: {user.role}
                        </div>
                    </div>
                    <button
                        onClick={logout}
                        style={{
                            padding: "0.3rem 0.8rem",
                            borderRadius: "999px",
                            border: "1px solid #d1d5db",
                            background: "#f9fafb",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                        }}
                    >
                        Logg ut
                    </button>
                </header>

                <main>
                    {user.role === "admin" ? (
                        <AdminPage user={user} />
                    ) : user.role === "teacher" ? (
                        <TeacherPage user={user} />
                    ) : (
                        <StudentPage user={user} />
                    )}
                </main>
            </div>
        </div>
    );
}

export default App;