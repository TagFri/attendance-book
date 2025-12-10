import React, { useEffect, useMemo, useState } from "react";
import { useTermOptions, labelFromTerm } from "./terms";
import { auth, db } from "./firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "firebase/auth";
import { toast } from "sonner";

type Props = {
  uid: string;
  role: "student" | "teacher" | "admin";
  onClose: () => void;
  displayName?: string | null;
  email: string;
};

type UserDoc = {
  phone?: string | null;
  secondaryEmail?: string | null;
  term?: number | null;
  allowedTerms?: number[];
  name?: string | null;
  displayName?: string | null;
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  backgroundColor: "#ffffff",
  borderRadius: "1rem",
  padding: "1rem 1.25rem",
  boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
};

const fieldLabel: React.CSSProperties = { fontSize: "0.8rem", display: "block" };
const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "0.35rem 0.5rem",
  borderRadius: "0.5rem",
  border: "1px solid #d1d5db",
  fontSize: "0.9rem",
  marginTop: "0.15rem",
  // Ensure the input respects its container width including padding and border
  boxSizing: "border-box",
};

const secondaryBtn: React.CSSProperties = {
  padding: "0.35rem 0.9rem",
  borderRadius: "999px",
  border: "1px solid #d1d5db",
  backgroundColor: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontSize: "0.9rem",
};

function ProfileModal({ uid, role, onClose, displayName, email }: Props) {
  const { options: termOptions } = useTermOptions();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [secondaryEmail, setSecondaryEmail] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState<string>(email);
  const [term, setTerm] = useState<number | null>(null);
  const [allowedTerms, setAllowedTerms] = useState<number[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const canSetSecondary = role === "teacher" || role === "student";

  // Track initial values to enable/disable save buttons
  const [initialPhone, setInitialPhone] = useState("");
  const [initialSecondaryEmail, setInitialSecondaryEmail] = useState("");
  const [initialPrimaryEmail, setInitialPrimaryEmail] = useState<string>(email);

  // Hover state for buttons to apply custom color on hover
  const [hoverBtn, setHoverBtn] = useState<{
    phone?: boolean;
    primaryEmail?: boolean;
    secondaryEmail?: boolean;
    password?: boolean;
  }>({});

  // Re-auth for sensitive operations (email change)
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthErr, setReauthErr] = useState<string | null>(null);
  const [pendingNewEmail, setPendingNewEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        const data = (snap.exists() ? (snap.data() as UserDoc) : {}) as UserDoc;
        if (!active) return;
        const p = String(data.phone ?? "");
        const se = String(data.secondaryEmail ?? "");
        const pe = String((data as any)?.email ?? email);
        setPhone(p);
        setSecondaryEmail(se);
        setPrimaryEmail(pe);
        setInitialPhone(p);
        setInitialSecondaryEmail(se);
        setInitialPrimaryEmail(pe);
        setTerm(typeof data.term === "number" ? data.term : null);
        const at = Array.isArray(data.allowedTerms)
          ? data.allowedTerms.filter((v): v is number => typeof v === "number")
          : [];
        setAllowedTerms(at);
        // Superadmin flag (admins with full access)
        try {
          // Read from raw data since UserDoc type doesn't include this optional flag
          const raw = snap.exists() ? (snap.data() as any) : {};
          setIsSuperAdmin(Boolean(raw?.isSuperAdmin));
        } catch {
          setIsSuperAdmin(false);
        }
      } catch (e) {
        if (active) setErr("Kunne ikke laste profildata.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [uid]);

  const allowedTermLabels = useMemo(() => {
    return allowedTerms.map((t) => labelFromTerm(termOptions, t));
  }, [allowedTerms, termOptions]);

  const savePhone = async () => {
    setErr(null);
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", uid), { phone: phone.trim() || null } as any);
      setInitialPhone(phone);
      toast.success("Mobilnummer er oppdatert.");
    } catch (e) {
      console.error(e);
      setErr("Kunne ikke lagre mobilnummer.");
      toast.error("Kunne ikke lagre mobilnummer.");
    } finally {
      setSaving(false);
    }
  };

  const saveSecondary = async () => {
    setErr(null);
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", uid), { secondaryEmail: secondaryEmail.trim() || null } as any);
      setInitialSecondaryEmail(secondaryEmail);
      toast.success("Sekundær e‑post er oppdatert.");
    } catch (e) {
      console.error(e);
      setErr("Kunne ikke lagre sekundær e‑post.");
      toast.error("Kunne ikke lagre sekundær e‑post.");
    } finally {
      setSaving(false);
    }
  };

  const changePrimaryEmail = async () => {
    setErr(null);
    const newEmail = primaryEmail.trim();
    if (!newEmail) {
      setErr("E‑post kan ikke være tom.");
      toast.error("E‑post kan ikke være tom.");
      return;
    }
    if (newEmail === initialPrimaryEmail) {
      toast.info?.("E‑posten er uendret.") || toast("E‑posten er uendret.");
      return;
    }
    try {
      const cu = auth.currentUser;
      if (!cu) {
        setErr("Ingen innlogget bruker.");
        toast.error("Ingen innlogget bruker.");
        return;
      }
      // Firebase policy may require verifying the new email before applying the change.
      // Use verifyBeforeUpdateEmail so Firebase sends a confirmation to the new address.
      await verifyBeforeUpdateEmail(cu, newEmail);
      // Do NOT update Firestore user email yet; it will change after the user confirms via the link.
      setInitialPrimaryEmail(newEmail);
      toast.success(
        `Vi har sendt en bekreftelseslenke til ${newEmail}. Følg lenken for å fullføre endringen av e‑post.`,
      );
    } catch (e: any) {
      console.warn("updateEmail failed", e);
      if (e?.code === "auth/operation-not-allowed") {
        // Backend requires verification before changing email or the operation is restricted
        setErr(
          "Kan ikke oppdatere e‑post direkte. Du må bekrefte ny e‑post via lenken vi sender. Prøv igjen."
        );
        toast.error(
          "Kan ikke oppdatere e‑post direkte. Bruk knappen igjen for å få tilsendt bekreftelseslenke."
        );
      } else if (e?.code === "auth/requires-recent-login") {
        // Open inline re-auth modal and, upon success, finish the email change
        setPendingNewEmail(newEmail);
        setReauthPassword("");
        setReauthErr(null);
        setReauthOpen(true);
        toast.info?.("Av sikkerhetshensyn må du bekrefte med passord før du kan endre e‑post.") ||
          toast("Av sikkerhetshensyn må du bekrefte med passord før du kan endre e‑post.");
      } else if (e?.code === "auth/email-already-in-use") {
        setErr("E‑postadressen er allerede i bruk av en annen bruker.");
        toast.error("E‑postadressen er allerede i bruk av en annen bruker.");
      } else if (e?.code === "auth/invalid-email") {
        setErr("Ugyldig e‑post.");
        toast.error("Ugyldig e‑post.");
      } else {
        setErr("Kunne ikke oppdatere e‑post. Prøv igjen senere.");
        toast.error("Kunne ikke oppdatere e‑post. Prøv igjen senere.");
      }
    }
  };

  const cancelReauth = () => {
    setReauthOpen(false);
    setReauthPassword("");
    setReauthErr(null);
    // Do not discard pendingNewEmail; leaving it allows the user to try again
  };

  const confirmReauthAndUpdateEmail = async () => {
    setReauthErr(null);
    const newEmail = (pendingNewEmail || primaryEmail || "").trim();
    if (!newEmail) {
      setReauthErr("Ugyldig ny e‑post.");
      return;
    }
    const cu = auth.currentUser;
    if (!cu) {
      setReauthErr("Ingen innlogget bruker.");
      return;
    }
    if (!reauthPassword) {
      setReauthErr("Skriv inn passordet ditt.");
      return;
    }
    try {
      setReauthLoading(true);
      const cred = EmailAuthProvider.credential(cu.email || email, reauthPassword);
      await reauthenticateWithCredential(cu, cred);
      // After reauth, immediately trigger verifyBeforeUpdateEmail
      await verifyBeforeUpdateEmail(cu, newEmail);
      setReauthOpen(false);
      setReauthPassword("");
      setPendingNewEmail(null);
      toast.success(
        `Vi har sendt en bekreftelseslenke til ${newEmail}. Følg lenken for å fullføre endringen av e‑post.`
      );
    } catch (e: any) {
      console.error("Reauth/update email failed", e);
      if (e?.code === "auth/wrong-password") {
        setReauthErr("Feil passord.");
      } else if (e?.code === "auth/too-many-requests") {
        setReauthErr("For mange forsøk. Prøv igjen senere.");
      } else if (e?.code === "auth/invalid-email") {
        setReauthErr("Ugyldig e‑post.");
      } else if (e?.code === "auth/email-already-in-use") {
        setReauthErr("E‑postadressen er allerede i bruk av en annen bruker.");
      } else {
        setReauthErr("Kunne ikke bekrefte innlogging eller oppdatere e‑post.");
      }
    } finally {
      setReauthLoading(false);
    }
  };

  const changePassword = async () => {
    setErr(null);
    if (!newPassword || newPassword.length < 6) {
      setErr("Passord må være minst 6 tegn.");
      toast.error("Passord må være minst 6 tegn.");
      return;
    }
    try {
      const cu = auth.currentUser;
      if (!cu) {
        setErr("Ingen innlogget bruker.");
        toast.error("Ingen innlogget bruker.");
        return;
      }
      await updatePassword(cu, newPassword);
      toast.success("Passordet er oppdatert.");
      setNewPassword("");
    } catch (e: any) {
      console.warn("updatePassword failed", e);
      if (e?.code === "auth/requires-recent-login") {
        setErr("Du må logge inn på nytt før du kan endre passord.");
        toast.error("Du må logge inn på nytt før du kan endre passord.");
      } else {
        setErr("Kunne ikke endre passord.");
        toast.error("Kunne ikke endre passord.");
      }
    }
  };

  return (
    <>
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
      aria-modal
      role="dialog"
    >
      <div style={cardStyle}>
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center" ,
          marginBottom: "1rem",
        }}>
          <h3 style={{ margin: 0 }}>{displayName || email}</h3>
          <button type="button" onClick={onClose} className="button-small button-border button-colorless">
            Lukk
          </button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "1rem 0" }}>
            Laster...
          </div>
        ) : (
          <>
            {/* Readonly role-specific info */}
              {role === "student" && (
                <div style={{ fontSize: "0.9rem", color: "#374151" }}>
                  <div style={{ fontWeight: 600 }}>Din termin</div>
                  <div>{labelFromTerm(termOptions, term)}</div>
                </div>
              )}

              {role === "teacher" && (
                <div style={{ fontSize: "0.9rem", color: "#374151" }}>
                  <div style={{ fontWeight: 600 }}>Terminer du kan registrere oppmøte på:</div>
                  {allowedTerms.length === 0 ? (
                    <div>Ingen</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" }}>
                      {allowedTermLabels.map((lbl, idx) => (
                        <span key={idx} style={{
                          display: "inline-block",
                          padding: "0.15rem 0.5rem",
                          border: "1px solid #e5e7eb",
                          borderRadius: "999px",
                          background: "#f9fafb",
                          fontSize: "0.8rem",
                        }}>{lbl}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {role === "admin" && (
                <div style={{ fontSize: "0.9rem", color: "#374151" }}>
                  {isSuperAdmin ? (
                    <div style={{ fontWeight: 600 }}>Super administrator</div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600 }}>Moduler du administrerer:</div>
                      {allowedTerms.length === 0 ? (
                        <div>Ingen</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" }}>
                          {allowedTermLabels.map((lbl, idx) => (
                            <span key={idx} style={{
                              display: "inline-block",
                              padding: "0.15rem 0.5rem",
                              border: "1px solid #e5e7eb",
                              borderRadius: "999px",
                              background: "#f9fafb",
                              fontSize: "0.8rem",
                            }}>{lbl}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            {/* Redesign av felter: hver rad med lagre-knapp til høyre */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
              {/* Mobilnummer */}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={fieldLabel}>
                    Mobilnummer
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Eks: 99999999"
                      style={fieldInput}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={saving || phone === initialPhone}
                  onMouseEnter={() => setHoverBtn((s) => ({ ...s, phone: true }))}
                  onMouseLeave={() => setHoverBtn((s) => ({ ...s, phone: false }))}
                  onClick={savePhone}
                  className="button-black button-small"
                >
                  Lagre
                </button>
              </div>

              {/* Primær e‑post */}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={fieldLabel}>
                    E‑post
                    <input
                      type="email"
                      value={primaryEmail}
                      onChange={(e) => setPrimaryEmail(e.target.value)}
                      placeholder="din@epost.no"
                      style={fieldInput}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={saving || primaryEmail.trim() === initialPrimaryEmail.trim()}
                  onMouseEnter={() => setHoverBtn((s) => ({ ...s, primaryEmail: true }))}
                  onMouseLeave={() => setHoverBtn((s) => ({ ...s, primaryEmail: false }))}
                  onClick={changePrimaryEmail}
                  className="button-black button-small"
                >
                  Lagre
                </button>
              </div>

              {/* Sekundær e‑post (kun for student/lærer) */}
              {canSetSecondary && (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={fieldLabel}>
                      Sekundær e‑post
                      <input
                        type="email"
                        value={secondaryEmail}
                        onChange={(e) => setSecondaryEmail(e.target.value)}
                        placeholder="eksempel@uio.no"
                        style={fieldInput}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={saving || secondaryEmail === initialSecondaryEmail}
                    onMouseEnter={() => setHoverBtn((s) => ({ ...s, secondaryEmail: true }))}
                    onMouseLeave={() => setHoverBtn((s) => ({ ...s, secondaryEmail: false }))}
                    onClick={saveSecondary}
                    className="button-black button-small"
                  >
                    Lagre
                  </button>
                </div>
              )}

              {/* Nytt passord */}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={fieldLabel}>
                    Nytt passord
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minst 6 tegn"
                      style={fieldInput}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={saving || newPassword.length === 0}
                  onMouseEnter={() => setHoverBtn((s) => ({ ...s, password: true }))}
                  onMouseLeave={() => setHoverBtn((s) => ({ ...s, password: false }))}
                  onClick={changePassword}
                  className="button-black button-small"
                >
                  Lagre
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>

    {/* Re-auth modal for changing primary email */}
    {reauthOpen && (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          zIndex: 70,
        }}
      >
        <div
          className="page-card"
          style={{ maxWidth: 520, width: "100%", background: "#ffffff" }}
        >
          <h3 style={{ marginTop: 0 }}>Logg inn på nytt</h3>
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
            Av sikkerhetshensyn må du bekrefte kontoen før du kan endre e‑post.
            {"\n"}
            Skriv inn passordet for {email}.
          </p>
          <label style={fieldLabel}>
            Passord
            <input
              type="password"
              value={reauthPassword}
              onChange={(e) => setReauthPassword(e.target.value)}
              placeholder="Passord"
              style={fieldInput}
              autoFocus
            />
          </label>
          {reauthErr && (
            <p style={{ color: "#b91c1c", fontSize: "0.85rem", marginTop: "0.5rem" }}>{reauthErr}</p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.75rem" }}>
            <button type="button" onClick={cancelReauth} style={secondaryBtn}>
              Avbryt
            </button>
            <button
              type="button"
              onClick={confirmReauthAndUpdateEmail}
              style={{
                background: "#6CE1AB",
                color: "black",
                cursor: "pointer",
              }}
              disabled={reauthLoading}
            >
              {reauthLoading ? "Bekrefter..." : "Bekreft og send lenke"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default ProfileModal;
