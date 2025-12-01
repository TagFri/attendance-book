import LoadingSpinner from "./LoadingSpinner";
import type React from "react";
import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { auth } from "./firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { toast } from "sonner";
import StudentPage from "./StudentPage";
import TeacherPage from "./TeacherPage";
import AdminPage from "./AdminPage";
import Footer from "./Footer";

const outerStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // UiO typografi – bruk Helvetica som basis (matches global CSS)
    fontFamily: "Helvetica, Arial, sans-serif",
};

function App() {
    const { user, loading, login, logout } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    // Registrering er deaktivert – kun innlogging
    const [authError, setAuthError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [sendingReset, setSendingReset] = useState(false);

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

    const handleForgotPassword = async () => {
        const trimmed = email.trim();
        if (!trimmed) {
            toast.error("Skriv inn e‑postadressen din først.");
            return;
        }
        setSendingReset(true);
        try {
            await sendPasswordResetEmail(auth, trimmed);
            toast.success("Sendte e‑post for tilbakestilling av passord.");
        } catch (err: any) {
            console.error(err);
            let msg = "Kunne ikke sende e‑post for tilbakestilling.";
            if (err?.code === "auth/invalid-email") {
                msg = "Ugyldig e‑postadresse.";
            } else if (err?.code === "auth/user-not-found") {
                // For sikkerhet kan vi bruke en nøytral melding, men vi informerer brukeren om å sjekke adressen
                msg = "Fant ingen bruker for denne e‑postadressen.";
            }
            toast.error(msg);
        } finally {
            setSendingReset(false);
        }
    };

    if (loading) {
        return (
            <>
                {/* Main viewport-height wrapper to keep footer below the fold */}
                <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "1rem 0.75rem 0", width: "100%" }}>
                    <div className="page-card">
                        <LoadingSpinner />
                    </div>
                </div>
                {/* Footer rendered outside the 100vh wrapper so it starts out of sight */}
                <Footer />
            </>
        );
    }

    if (!user) {
        return (
            <>
                <div className="front-page" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", background: "#CEFFDF", width: "100%", padding: "1rem 0.75rem 0" }}>
                    <div className="page-card">
                        <h1 style={{ marginBottom: "2rem", textAlign: "center"}}>Oppmøteregistrering</h1>

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
                                    marginTop: "1.5rem",
                                    marginBottom: "1rem",
                                }}
                            >
                                {submitting ? "Logger inn..." : "Logg inn"}
                            </button>
                            <button
                                type="button"
                                onClick={handleForgotPassword}
                                disabled={sendingReset}
                                style={{
                                    width: "100%",
                                    padding: "0.6rem 1rem",
                                    borderRadius: "999px",
                                    border: "none",
                                    background: "#6CE1AB",
                                    color: "black",
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    marginTop: 0,
                                    marginBottom: "0.25rem",
                                }}
                            >
                                {sendingReset ? "Sender e‑post..." : "Glemt passord"}
                            </button>
                        </form>
                    </div>
                </div>
                <Footer />
            </>
        );
    }

    // Innlogget
    return (
        <>
            {/* Center page content until it grows tall; leave slim top/side background */}
            <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", padding: "1rem 0.75rem 0" }}>
                {user.role === "admin" ? (
                    <AdminPage user={user} />
                ) : user.role === "teacher" ? (
                    <TeacherPage user={user} />
                ) : (
                    <StudentPage user={user} />
                )}
            </div>
            {/* Footer sits after the viewport-height content, so it starts out of sight */}
            <Footer />
        </>
        );
}

export default App;