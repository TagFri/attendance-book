import LoadingSpinner from "./LoadingSpinner";
import type React from "react";
import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import StudentPage from "./StudentPage";
import TeacherPage from "./TeacherPage";
import AdminPage from "./AdminPage";

function App() {
    const { user, loading, login, logout } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    // Registrering er deaktivert – kun innlogging
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
            // Kun innlogging støttes
            await login(email.trim(), password);
            // onAuthStateChanged tar over etter dette
        } catch (err: any) {
            console.error(err);
            let msg = "Kunne ikke logge inn.";
            if (err?.code === "auth/user-not-found") {
                msg = "Bruker finnes ikke.";
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
            <div className="app-outer" style={{ width: "100%" }}>
                <div className="bg-column">
                    <div className="page-card">
                        <LoadingSpinner />
                    </div>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="app-outer" style={{ width: "100%" }}>
                <div className="bg-column front-page" style={{ background: "#CEFFDF" }}>
                    <div className="page-card" style={{ margin: "0.75rem auto" }}>
                        <h1 style={{ marginBottom: "1.25rem", textAlign: "center" }}>Oppmøteregistrering</h1>

                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: "0.75rem" }}>
                                <label
                                    style={{
                                        display: "block",
                                        fontSize: "0.85rem",
                                        marginBottom: "0.2rem",
                                    }}
                                >
                                    Mobil / Epost
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="uiobrukernavn@uio.no"
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
                                    background: "#6CE1AB",
                                    color: "black",
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    marginTop: "1.25rem",
                                }}
                            >
                                {submitting ? "Logger inn..." : "Logg inn"}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    // Innlogget
    return (
        <div className="app-outer" style={{ width: "100%" }}>
            <div
                className="bg-column"
                style={{
                    background:
                        user.role === "teacher"
                            ? "#FDCB87"
                            : user.role === "student"
                            ? "#CEFFDF"
                            : "#f5f5f7",
                }}
            >
                <header
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingTop: "0.75rem",
                        paddingBottom: "0.5rem",
                    }}
                >
                    <div>
                        <div>{user.displayName || user.email}</div>
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