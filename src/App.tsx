import LoadingSpinner from "./LoadingSpinner";
import type React from "react";
import {useState, useEffect, useRef} from "react";
import {useAuth} from "./hooks/useAuth";
import {auth} from "./firebase";
import {sendPasswordResetEmail} from "firebase/auth";
import {toast} from "sonner";
import StudentPage from "./StudentPage";
import TeacherPage from "./TeacherPage";
import AdminPage from "./AdminPage";
import Footer from "./Footer";
import Header from "./Header";

function App() {
    const {user, login} = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState<string | null>(null);
    const [authSuccess, setAuthSuccess] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [sendingReset, setSendingReset] = useState(false);
    
    // Refs to manage field focus
    const emailRef = useRef<HTMLInputElement | null>(null);
    const passwordRef = useRef<HTMLInputElement | null>(null);
    
    // Auto-clear auth messages after 3 seconds
    useEffect(() => {
        if (!authError) return;
        const t = setTimeout(() => setAuthError(null), 3000);
        return () => clearTimeout(t);
    }, [authError]);

    useEffect(() => {
        if (!authSuccess) return;
        const t = setTimeout(() => setAuthSuccess(null), 3000);
        return () => clearTimeout(t);
    }, [authSuccess]);

    // On successful login, scroll to the top of the page
    useEffect(() => {
        if (user) {
            try {
                window.scrollTo({ top: 0, behavior: "smooth" });
            } catch {
                // fallback for environments without smooth scroll support
                window.scrollTo(0, 0);
            }
        }
    }, [user]);

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
            setAuthError("Skriv inn e‑postadressen din først.");
            return;
        }
        setSendingReset(true);
        try {
            await sendPasswordResetEmail(auth, trimmed);
            setAuthSuccess("Sendte e‑post for tilbakestilling av passord.");
        } catch (err: any) {
            console.error(err);
            let msg = "Kunne ikke sende e‑post for tilbakestilling.";
            if (err?.code === "auth/invalid-email") {
                msg = "Ugyldig e‑postadresse.";
            } else if (err?.code === "auth/user-not-found") {
                // For sikkerhet kan vi bruke en nøytral melding, men vi informerer brukeren om å sjekke adressen
                msg = "Fant ingen bruker for denne e‑postadressen.";
            }
            setAuthError(msg);
        } finally {
            setSendingReset(false);
        }
    };

    // NO USER -> SHOW LANDING LOGIN PAGE
    if (!user) {
        return (
            <>
                <div id="main">
                    <div id="loginMan">
                        <img src="/logo.svg" alt="Logo" className=""/>
                    </div>
                    <div className="card round-corners-full login-card">
                        <h1>Velkommen tilbake</h1>
                        <form onSubmit={handleSubmit}>
                            <div className="input-group">
                                <label className="input-label">Mobil / epost</label>
                                <input className="input-field round-corners-half"
                                       type="email"
                                       value={email}
                                       onChange={(e) => setEmail(e.target.value)}
                                       ref={emailRef}
                                       onKeyDown={(e) => {
                                           if (e.key === "Enter") {
                                               e.preventDefault();
                                               passwordRef.current?.focus();
                                           }
                                       }}
                                       enterKeyHint="next"
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Passord</label>
                                <input className="input-field round-corners-half"
                                       type="password"
                                       value={password}
                                       onChange={(e) => setPassword(e.target.value)}
                                       ref={passwordRef}
                                       enterKeyHint="go"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submitting}
                                className="button-primary button-black round-corners-half"
                            >
                                {submitting ? "Logger inn..." : "Logg inn"}
                            </button>
                            <button
                                type="button"
                                onClick={handleForgotPassword}
                                disabled={sendingReset}
                                className="button-colorless boldFont"
                            >
                                {sendingReset ? "Sender e‑post..." : "Glemt passord"}
                            </button>
                            <p className="errorTxt"><br/>
                                {authError}
                            </p>
                            <p className="successTxt"><br/>
                                {authSuccess}
                            </p>
                        </form>
                    </div>
                </div>
                <Footer/>
            </>
        );
    }

    // Innlogget
    return (
        <>
            {/* Center page content until it grows tall; leave slim top/side background */}
            <Header user={user}></Header>
            <div id="main">
                {user.role === "admin" ? (
                    <AdminPage user={user}/>
                ) : user.role === "teacher" ? (
                    <TeacherPage user={user}/>
                ) : (
                    <StudentPage user={user}/>
                )}
            </div>
            {/* Footer sits after the viewport-height content, so it starts out of sight */}
            <Footer/>
        </>
    );


}

export default App;