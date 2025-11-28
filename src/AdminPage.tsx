import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { auth, db, secondaryAuth } from "./firebase";
import { signOut } from "firebase/auth";
import {
    collection,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    doc,
    writeBatch,
    query,
    where,
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { TERM_OPTIONS, termLabel, termShortLabel } from "./termConfig";

// ---------- Typer ----------

type Requirement = {
    id: string;
    term: number;
    category: string;
    requiredCount: number;
};

type TimeDef = {
    id: string;
    name: string;
    category: string;
    term: number;
};

type AdminUserRow = {
    docId: string;
    email: string;
    displayName: string;
    role: "student" | "teacher" | "admin";
    term?: number | null;
    phone?: string | null;
    allowedTerms?: number[];
};

// ---------- Hjelpere ----------

function leadingNumberFromName(name: string): number {
    const match = name.match(/^\s*(\d+)/);
    return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}

function generateTempPassword(): string {
    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
    let pwd = "";
    for (let i = 0; i < 12; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    return pwd;
}

// ---------- Brukeradministrasjon ----------

const UsersAdmin: React.FC = () => {
    const [allUsers, setAllUsers] = useState<AdminUserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [activeTab, setActiveTab] = useState<"teachers" | "students" | "admins">(
        "teachers"
    );

    // Lærere: filter + sort
    const [teacherTermFilter, setTeacherTermFilter] = useState<number | "all">(
        "all"
    );
    const [teacherSortKey, setTeacherSortKey] = useState<
        "name" | "email" | "phone"
    >("name");
    const [teacherSortDir, setTeacherSortDir] = useState<"asc" | "desc">("asc");

    // Studenter: filter + sort
    const [studentTermFilter, setStudentTermFilter] = useState<number | "all">(
        "all"
    );
    const [studentSortKey, setStudentSortKey] = useState<
        "name" | "email" | "phone"
    >("name");
    const [studentSortDir, setStudentSortDir] = useState<"asc" | "desc">("asc");

    // Admins: sort
    const [adminSortKey, setAdminSortKey] = useState<
        "name" | "email" | "phone"
    >("name");
    const [adminSortDir, setAdminSortDir] = useState<"asc" | "desc">("asc");

    // Modal for lærere (create/edit)
    const [teacherModalMode, setTeacherModalMode] = useState<
        "create" | "edit" | null
    >(null);
    const [teacherModalUser, setTeacherModalUser] = useState<AdminUserRow | null>(
        null
    );
    const [editTeacherName, setEditTeacherName] = useState("");
    const [editTeacherEmail, setEditTeacherEmail] = useState("");
    const [editTeacherPhone, setEditTeacherPhone] = useState("");
    const [editTeacherRole, setEditTeacherRole] = useState<
        "student" | "teacher" | "admin"
    >("teacher");
    const [editTeacherAllowedTerms, setEditTeacherAllowedTerms] = useState<
        number[]
    >([]);

    // Modal for studenter (create/edit)
    const [studentModalMode, setStudentModalMode] = useState<
        "create" | "edit" | null
    >(null);
    const [studentModalUser, setStudentModalUser] = useState<AdminUserRow | null>(
        null
    );
    const [editStudentName, setEditStudentName] = useState("");
    const [editStudentEmail, setEditStudentEmail] = useState("");
    const [editStudentPhone, setEditStudentPhone] = useState("");
    const [editStudentRole, setEditStudentRole] = useState<
        "student" | "teacher" | "admin"
    >("student");
    const [editStudentTerm, setEditStudentTerm] = useState<number | null>(null);

    // Modal for admins (create/edit)
    const [adminModalMode, setAdminModalMode] = useState<
        "create" | "edit" | null
    >(null);
    const [adminModalUser, setAdminModalUser] = useState<AdminUserRow | null>(
        null
    );
    const [editAdminName, setEditAdminName] = useState("");
    const [editAdminEmail, setEditAdminEmail] = useState("");
    const [editAdminPhone, setEditAdminPhone] = useState("");
    const [editAdminRole, setEditAdminRole] = useState<
        "student" | "teacher" | "admin"
    >("admin");

    useEffect(() => {
        const loadUsers = async () => {
            try {
                setLoading(true);
                const snap = await getDocs(collection(db, "users"));
                const list: AdminUserRow[] = snap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        docId: d.id,
                        email: data.email ?? "",
                        displayName:
                            data.name ?? data.displayName ?? data.email ?? "(uten navn)",
                        role: (data.role as any) ?? "student",
                        term: data.term ?? null,
                        phone: data.phone ?? null,
                        allowedTerms: data.allowedTerms ?? [],
                    };
                });

                // default: sorter på navn
                list.sort((a, b) =>
                    a.displayName.localeCompare(b.displayName, "nb-NO", {
                        sensitivity: "base",
                    })
                );

                setAllUsers(list);
            } catch (err) {
                console.error("Feil ved lasting av brukere:", err);
                setAllUsers([]);
            } finally {
                setLoading(false);
            }
        };

        void loadUsers();
    }, []);

    // Globalt søk: navn + epost + mobil
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return allUsers;
        return allUsers.filter((u) => {
            const namePart = (u.displayName ?? "").toLowerCase();
            const emailPart = (u.email ?? "").toLowerCase();
            const phonePart = (u.phone ?? "").toLowerCase();
            const text = `${namePart} ${emailPart} ${phonePart}`;
            return text.includes(q);
        });
    }, [allUsers, search]);

    // Del opp på rolle
    let teachers = filtered.filter((u) => u.role === "teacher");
    let students = filtered.filter((u) => u.role === "student");
    let admins = filtered.filter((u) => u.role === "admin");

    // Filter lærere på termin
    if (teacherTermFilter !== "all") {
        const tVal = teacherTermFilter as number;
        teachers = teachers.filter((u) =>
            (u.allowedTerms ?? []).includes(tVal)
        );
    }

    // Filter studenter på termin
    if (studentTermFilter !== "all") {
        const tVal = studentTermFilter as number;
        students = students.filter((u) => u.term === tVal);
    }

    // Sorter lærere
    teachers.sort((a, b) => {
        const getField = (u: AdminUserRow) => {
            if (teacherSortKey === "name") return u.displayName ?? "";
            if (teacherSortKey === "email") return u.email ?? "";
            return u.phone ?? "";
        };
        const va = getField(a).toLowerCase();
        const vb = getField(b).toLowerCase();
        if (va < vb) return teacherSortDir === "asc" ? -1 : 1;
        if (va > vb) return teacherSortDir === "asc" ? 1 : -1;
        return 0;
    });

    // Sorter studenter
    students.sort((a, b) => {
        const getField = (u: AdminUserRow) => {
            if (studentSortKey === "name") return u.displayName ?? "";
            if (studentSortKey === "email") return u.email ?? "";
            return u.phone ?? "";
        };
        const va = getField(a).toLowerCase();
        const vb = getField(b).toLowerCase();
        if (va < vb) return studentSortDir === "asc" ? -1 : 1;
        if (va > vb) return studentSortDir === "asc" ? 1 : -1;
        return 0;
    });

    // Sorter admins
    admins.sort((a, b) => {
        const getField = (u: AdminUserRow) => {
            if (adminSortKey === "name") return u.displayName ?? "";
            if (adminSortKey === "email") return u.email ?? "";
            return u.phone ?? "";
        };
        const va = getField(a).toLowerCase();
        const vb = getField(b).toLowerCase();
        if (va < vb) return adminSortDir === "asc" ? -1 : 1;
        if (va > vb) return adminSortDir === "asc" ? 1 : -1;
        return 0;
    });

    // Begrens til 50
    teachers = teachers.slice(0, 50);
    students = students.slice(0, 50);
    admins = admins.slice(0, 50);

    const toggleTeacherSort = (key: "name" | "email" | "phone") => {
        setTeacherSortKey((prevKey) => {
            if (prevKey === key) {
                setTeacherSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
                return prevKey;
            }
            setTeacherSortDir("asc");
            return key;
        });
    };

    const toggleStudentSort = (key: "name" | "email" | "phone") => {
        setStudentSortKey((prevKey) => {
            if (prevKey === key) {
                setStudentSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
                return prevKey;
            }
            setStudentSortDir("asc");
            return key;
        });
    };

    const toggleAdminSort = (key: "name" | "email" | "phone") => {
        setAdminSortKey((prevKey) => {
            if (prevKey === key) {
                setAdminSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
                return prevKey;
            }
            setAdminSortDir("asc");
            return key;
        });
    };

    const updateUserField = async (
        docId: string,
        field:
            | "role"
            | "term"
            | "phone"
            | "allowedTerms"
            | "email"
            | "displayName",
        value: any
    ) => {
        try {
            const ref = doc(db, "users", docId);
            await updateDoc(ref, { [field]: value });
            setAllUsers((prev) =>
                prev.map((u) => (u.docId === docId ? { ...u, [field]: value } : u))
            );
        } catch (err) {
            console.error("Feil ved oppdatering av brukerfelt:", err);
            alert("Kunne ikke oppdatere bruker.");
        }
    };

    // ---------- LÆRERE: CREATE / EDIT (modal) ----------

    const openCreateTeacherModal = () => {
        setTeacherModalMode("create");
        setTeacherModalUser(null);
        setEditTeacherName("");
        setEditTeacherEmail("");
        setEditTeacherPhone("");
        setEditTeacherRole("teacher");
        setEditTeacherAllowedTerms([]);
    };

    const handleSaveCreateTeacher = async () => {
        const email = editTeacherEmail.trim();
        const name = editTeacherName.trim();
        const phone = editTeacherPhone.trim();

        if (!email) {
            alert("E-post må fylles ut for å opprette lærer.");
            return;
        }

        if (!editTeacherAllowedTerms || editTeacherAllowedTerms.length === 0) {
            alert("Velg minst én termin læreren kan registrere for.");
            return;
        }

        try {
            const tempPassword = generateTempPassword();

            const cred = await createUserWithEmailAndPassword(
                secondaryAuth,
                email,
                tempPassword
            );
            const uid = cred.user.uid;

            const userDoc = {
                email,
                displayName: name || email,
                name: name || email,
                role: editTeacherRole,
                term: null,
                phone: phone || null,
                allowedTerms: editTeacherAllowedTerms,
            };

            await setDoc(doc(db, "users", uid), userDoc, { merge: true });

            setAllUsers((prev) => {
                const next: AdminUserRow[] = [
                    {
                        docId: uid,
                        email,
                        displayName: userDoc.displayName,
                        role: editTeacherRole,
                        term: null,
                        phone: phone || null,
                        allowedTerms: [...editTeacherAllowedTerms],
                    },
                    ...prev,
                ];
                next.sort((a, b) =>
                    a.displayName.localeCompare(b.displayName, "nb-NO", {
                        sensitivity: "base",
                    })
                );
                return next;
            });

            setTeacherModalMode(null);
            setTeacherModalUser(null);

            alert(
                `Ny lærer opprettet.\n\nE-post: ${email}\nMidlertidig passord: ${tempPassword}\n\nGi passordet til læreren og be dem bytte etter første innlogging.`
            );
        } catch (err: any) {
            console.error("Feil ved oppretting av lærer:", err);
            if (err?.code === "auth/email-already-in-use") {
                alert(
                    "E-posten er allerede i bruk i Auth. Bruk en annen eller koble eksisterende bruker."
                );
            } else {
                alert("Kunne ikke opprette lærer. Se console for mer info.");
            }
        }
    };

    const openEditTeacherModal = (u: AdminUserRow) => {
        setTeacherModalMode("edit");
        setTeacherModalUser(u);
        setEditTeacherName(u.displayName);
        setEditTeacherEmail(u.email);
        setEditTeacherPhone(u.phone ?? "");
        setEditTeacherRole(u.role);
        setEditTeacherAllowedTerms(u.allowedTerms ?? []);
    };

    const handleSaveEditTeacher = async () => {
        if (!teacherModalUser) return;
        const docId = teacherModalUser.docId;

        try {
            const ref = doc(db, "users", docId);
            await updateDoc(ref, {
                displayName: editTeacherName,
                email: editTeacherEmail,
                phone: editTeacherPhone || null,
                role: editTeacherRole,
                allowedTerms: editTeacherAllowedTerms,
            });

            setAllUsers((prev) =>
                prev.map((u) =>
                    u.docId === docId
                        ? {
                            ...u,
                            displayName: editTeacherName,
                            email: editTeacherEmail,
                            phone: editTeacherPhone || null,
                            role: editTeacherRole,
                            allowedTerms: [...editTeacherAllowedTerms],
                        }
                        : u
                )
            );

            setTeacherModalMode(null);
            setTeacherModalUser(null);
        } catch (err) {
            console.error("Feil ved lagring av lærer:", err);
            alert("Kunne ikke lagre endringer for lærer.");
        }
    };

    const closeTeacherModal = () => {
        setTeacherModalMode(null);
        setTeacherModalUser(null);
    };

    const toggleAllowedTermInTeacherModal = (termValue: number) => {
        setEditTeacherAllowedTerms((prev) =>
            prev.includes(termValue)
                ? prev.filter((v) => v !== termValue)
                : [...prev, termValue]
        );
    };

    // ---------- STUDENTER: CREATE / EDIT (modal) ----------

    const openCreateStudentModal = () => {
        setStudentModalMode("create");
        setStudentModalUser(null);
        setEditStudentName("");
        setEditStudentEmail("");
        setEditStudentPhone("");
        setEditStudentRole("student");
        setEditStudentTerm(null);
    };

    const handleSaveCreateStudent = async () => {
        const email = editStudentEmail.trim();
        const name = editStudentName.trim();
        const phone = editStudentPhone.trim();

        if (!email) {
            alert("E-post må fylles ut for å opprette student.");
            return;
        }

        if (editStudentTerm == null) {
            alert("Velg termin studenten tilhører.");
            return;
        }

        try {
            const tempPassword = generateTempPassword();

            const cred = await createUserWithEmailAndPassword(
                secondaryAuth,
                email,
                tempPassword
            );
            const uid = cred.user.uid;

            const userDoc = {
                email,
                displayName: name || email,
                name: name || email,
                role: editStudentRole,
                term: editStudentTerm,
                phone: phone || null,
                allowedTerms: [] as number[],
            };

            await setDoc(doc(db, "users", uid), userDoc, { merge: true });

            setAllUsers((prev) => {
                const next: AdminUserRow[] = [
                    {
                        docId: uid,
                        email,
                        displayName: userDoc.displayName,
                        role: editStudentRole,
                        term: editStudentTerm,
                        phone: phone || null,
                        allowedTerms: [],
                    },
                    ...prev,
                ];
                next.sort((a, b) =>
                    a.displayName.localeCompare(b.displayName, "nb-NO", {
                        sensitivity: "base",
                    })
                );
                return next;
            });

            setStudentModalMode(null);
            setStudentModalUser(null);

            alert(
                `Ny student opprettet.\n\nE-post: ${email}\nMidlertidig passord: ${tempPassword}\n\nGi passordet til studenten og be dem bytte etter første innlogging.`
            );
        } catch (err: any) {
            console.error("Feil ved oppretting av student:", err);
            if (err?.code === "auth/email-already-in-use") {
                alert(
                    "E-posten er allerede i bruk i Auth. Bruk en annen eller koble eksisterende bruker."
                );
            } else {
                alert("Kunne ikke opprette student. Se console for mer info.");
            }
        }
    };

    const openEditStudentModal = (u: AdminUserRow) => {
        setStudentModalMode("edit");
        setStudentModalUser(u);
        setEditStudentName(u.displayName);
        setEditStudentEmail(u.email);
        setEditStudentPhone(u.phone ?? "");
        setEditStudentRole(u.role);
        setEditStudentTerm(u.term ?? null);
    };

    const handleSaveEditStudent = async () => {
        if (!studentModalUser) return;
        const docId = studentModalUser.docId;

        try {
            const ref = doc(db, "users", docId);
            await updateDoc(ref, {
                displayName: editStudentName,
                email: editStudentEmail,
                phone: editStudentPhone || null,
                role: editStudentRole,
                term: editStudentTerm ?? null,
            });

            setAllUsers((prev) =>
                prev.map((u) =>
                    u.docId === docId
                        ? {
                            ...u,
                            displayName: editStudentName,
                            email: editStudentEmail,
                            phone: editStudentPhone || null,
                            role: editStudentRole,
                            term: editStudentTerm ?? null,
                        }
                        : u
                )
            );

            setStudentModalMode(null);
            setStudentModalUser(null);
        } catch (err) {
            console.error("Feil ved lagring av student:", err);
            alert("Kunne ikke lagre endringer for student.");
        }
    };

    const closeStudentModal = () => {
        setStudentModalMode(null);
        setStudentModalUser(null);
    };

    // ---------- ADMINS: CREATE / EDIT (modal) ----------

    const openCreateAdminModal = () => {
        setAdminModalMode("create");
        setAdminModalUser(null);
        setEditAdminName("");
        setEditAdminEmail("");
        setEditAdminPhone("");
        setEditAdminRole("admin");
    };

    const handleSaveCreateAdmin = async () => {
        const email = editAdminEmail.trim();
        const name = editAdminName.trim();
        const phone = editAdminPhone.trim();

        if (!email) {
            alert("E-post må fylles ut for å opprette admin.");
            return;
        }

        if (!phone) {
            alert("Mobilnummer må fylles ut for å opprette admin.");
            return;
        }

        try {
            const tempPassword = generateTempPassword();

            const cred = await createUserWithEmailAndPassword(
                secondaryAuth,
                email,
                tempPassword
            );
            const uid = cred.user.uid;

            const userDoc = {
                email,
                displayName: name || email,
                name: name || email,
                role: editAdminRole, // typisk 'admin'
                term: null,
                phone,               // alltid satt pga valideringen over
                allowedTerms: [] as number[],
            };

            await setDoc(doc(db, "users", uid), userDoc, { merge: true });

            setAllUsers((prev) => {
                const next: AdminUserRow[] = [
                    {
                        docId: uid,
                        email,
                        displayName: userDoc.displayName,
                        role: editAdminRole,
                        term: null,
                        phone,
                        allowedTerms: [],
                    },
                    ...prev,
                ];
                next.sort((a, b) =>
                    a.displayName.localeCompare(b.displayName, "nb-NO", {
                        sensitivity: "base",
                    })
                );
                return next;
            });

            setAdminModalMode(null);
            setAdminModalUser(null);

            alert(
                `Ny admin opprettet.\n\nE-post: ${email}\nMidlertidig passord: ${tempPassword}\n\nGi passordet til admin og be dem bytte etter første innlogging.`
            );
        } catch (err: any) {
            console.error("Feil ved oppretting av admin:", err);
            if (err?.code === "auth/email-already-in-use") {
                alert(
                    "E-posten er allerede i bruk i Auth. Bruk en annen eller koble eksisterende bruker."
                );
            } else {
                alert("Kunne ikke opprette admin. Se console for mer info.");
            }
        }
    };

    const openEditAdminModal = (u: AdminUserRow) => {
        setAdminModalMode("edit");
        setAdminModalUser(u);
        setEditAdminName(u.displayName);
        setEditAdminEmail(u.email);
        setEditAdminPhone(u.phone ?? "");
        setEditAdminRole(u.role);
    };

    const handleSaveEditAdmin = async () => {
        if (!adminModalUser) return;
        const docId = adminModalUser.docId;

        try {
            const ref = doc(db, "users", docId);
            await updateDoc(ref, {
                displayName: editAdminName,
                email: editAdminEmail,
                phone: editAdminPhone || null,
                role: editAdminRole,
            });

            setAllUsers((prev) =>
                prev.map((u) =>
                    u.docId === docId
                        ? {
                            ...u,
                            displayName: editAdminName,
                            email: editAdminEmail,
                            phone: editAdminPhone || null,
                            role: editAdminRole,
                        }
                        : u
                )
            );

            setAdminModalMode(null);
            setAdminModalUser(null);
        } catch (err) {
            console.error("Feil ved lagring av admin:", err);
            alert("Kunne ikke lagre endringer for admin.");
        }
    };

    const closeAdminModal = () => {
        setAdminModalMode(null);
        setAdminModalUser(null);
    };

    // ---------- RENDER ----------

    return (
        <div style={{ marginBottom: "2rem" }}>

            {/* Faner */}
            <div
                style={{
                    display: "flex",
                    gap: "0.5rem",
                    marginBottom: "0.75rem",
                }}
            >
                <button
                    type="button"
                    onClick={() => setActiveTab("teachers")}
                    style={{
                        flex: 1,
                        padding: "0.35rem 0.5rem",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: activeTab === "teachers" ? "#b91c1c" : "#ffffff",
                        color: activeTab === "teachers" ? "#ffffff" : "#111827",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                    }}
                >
                    Lærere
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("students")}
                    style={{
                        flex: 1,
                        padding: "0.35rem 0.5rem",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: activeTab === "students" ? "#b91c1c" : "#ffffff",
                        color: activeTab === "students" ? "#ffffff" : "#111827",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                    }}
                >
                    Studenter
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("admins")}
                    style={{
                        flex: 1,
                        padding: "0.35rem 0.5rem",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: activeTab === "admins" ? "#b91c1c" : "#ffffff",
                        color: activeTab === "admins" ? "#ffffff" : "#111827",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                    }}
                >
                    Admin
                </button>
            </div>
            {/* Globalt søk */}
            <input
                type="text"
                placeholder="Søk på navn, e-post eller mobil..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    marginBottom: "0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid #d1d5db",
                    fontSize: "0.9rem",
                }}
            />

            {loading ? (
                <p>Laster brukere...</p>
            ) : (
                <>
                    {/* LÆRERE */}
                    {activeTab === "teachers" && (
                        <div style={{ marginBottom: "1.2rem" }}>
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    justifyContent: "space-between",
                                    gap: "0.5rem",
                                    marginBottom: "0.4rem",
                                }}
                            >
                                <div style={{ fontSize: "0.8rem" }}>
                                    <label>
                                        <select
                                            value={teacherTermFilter === "all" ? "" : teacherTermFilter}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setTeacherTermFilter(
                                                    val === "" ? "all" : parseInt(val, 10)
                                                );
                                            }}
                                            style={{
                                                padding: "0.2rem 0.4rem",
                                                borderRadius: "0.5rem",
                                                border: "1px solid #d1d5db",
                                                fontSize: "0.8rem",
                                            }}
                                        >
                                            <option value="">Alle terminer</option>
                                            {TERM_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    onClick={openCreateTeacherModal}
                                    style={{
                                        padding: "0.3rem 0.7rem",
                                        borderRadius: "999px",
                                        border: "1px solid #d1d5db",
                                        backgroundColor: "#ffffff",
                                        fontSize: "0.8rem",
                                        cursor: "pointer",
                                    }}
                                >
                                    Legg til
                                </button>
                            </div>

                            <table
                                style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: "0.85rem",
                                }}
                            >
                                <thead>
                                <tr>
                                    <th
                                        style={{
                                            textAlign: "left",
                                            borderBottom: "1px solid #e5e7eb",
                                            padding: "0.25rem",
                                            cursor: "pointer",
                                        }}
                                        onClick={() => toggleTeacherSort("name")}
                                    >
                                        Navn{" "}
                                        {teacherSortKey === "name" &&
                                            (teacherSortDir === "asc" ? "▲" : "▼")}
                                    </th>
                                    <th
                                        style={{
                                            textAlign: "left",
                                            borderBottom: "1px solid #e5e7eb",
                                            padding: "0.25rem",
                                            cursor: "pointer",
                                        }}
                                        onClick={() => toggleTeacherSort("email")}
                                    >
                                        E-post{" "}
                                        {teacherSortKey === "email" &&
                                            (teacherSortDir === "asc" ? "▲" : "▼")}
                                    </th>
                                    <th
                                        style={{
                                            textAlign: "left",
                                            borderBottom: "1px solid #e5e7eb",
                                            padding: "0.25rem",
                                            cursor: "pointer",
                                        }}
                                        onClick={() => toggleTeacherSort("phone")}
                                    >
                                        Mobil{" "}
                                        {teacherSortKey === "phone" &&
                                            (teacherSortDir === "asc" ? "▲" : "▼")}
                                    </th>
                                </tr>
                                </thead>
                                <tbody>
                                {teachers.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={3}
                                            style={{
                                                padding: "0.4rem",
                                                fontSize: "0.85rem",
                                                color: "#6b7280",
                                            }}
                                        >
                                            Ingen lærere funnet.
                                        </td>
                                    </tr>
                                ) : (
                                    teachers.map((u) => (
                                        <tr
                                            key={u.docId}
                                            onClick={() => openEditTeacherModal(u)}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.displayName}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.email}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.phone ?? "—"}
                                            </td>
                                        </tr>
                                    ))
                                )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* STUDENTER */}
                    {activeTab === "students" && (
                        <div style={{ marginBottom: "1.2rem" }}>
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    justifyContent: "space-between",
                                    gap: "0.5rem",
                                    marginBottom: "0.4rem",
                                }}
                            >
                                <div style={{ fontSize: "0.8rem" }}>
                                    <label>
                                        <select
                                            value={studentTermFilter === "all" ? "" : studentTermFilter}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setStudentTermFilter(
                                                    val === "" ? "all" : parseInt(val, 10)
                                                );
                                            }}
                                            style={{
                                                padding: "0.2rem 0.4rem",
                                                borderRadius: "0.5rem",
                                                border: "1px solid #d1d5db",
                                                fontSize: "0.8rem",
                                            }}
                                        >
                                            <option value="">Alle terminer</option>
                                            {TERM_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    onClick={openCreateStudentModal}
                                    style={{
                                        padding: "0.3rem 0.7rem",
                                        borderRadius: "999px",
                                        border: "1px solid #d1d5db",
                                        backgroundColor: "#ffffff",
                                        fontSize: "0.8rem",
                                        cursor: "pointer",
                                    }}
                                >
                                    Legg til
                                </button>


                            </div>

                            {students.length === 0 ? (
                                <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                                    Ingen studenter funnet.
                                </p>
                            ) : (
                                <table
                                    style={{
                                        width: "100%",
                                        borderCollapse: "collapse",
                                        fontSize: "0.85rem",
                                    }}
                                >
                                    <thead>
                                    <tr>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                                cursor: "pointer",
                                            }}
                                            onClick={() => toggleStudentSort("name")}
                                        >
                                            Navn{" "}
                                            {studentSortKey === "name" &&
                                                (studentSortDir === "asc" ? "▲" : "▼")}
                                        </th>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                                cursor: "pointer",
                                            }}
                                            onClick={() => toggleStudentSort("email")}
                                        >
                                            E-post{" "}
                                            {studentSortKey === "email" &&
                                                (studentSortDir === "asc" ? "▲" : "▼")}
                                        </th>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                                cursor: "pointer",
                                            }}
                                            onClick={() => toggleStudentSort("phone")}
                                        >
                                            Mobil{" "}
                                            {studentSortKey === "phone" &&
                                                (studentSortDir === "asc" ? "▲" : "▼")}
                                        </th>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                            }}
                                        >
                                            Termin
                                        </th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {students.map((u) => (
                                        <tr
                                            key={u.docId}
                                            onClick={() => openEditStudentModal(u)}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.displayName}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.email}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.phone ?? "—"}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.term != null && u.term !== undefined
                                                    ? termShortLabel(u.term)
                                                    : "Ingen"}
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {/* ADMINS */}
                    {activeTab === "admins" && (
                        <div style={{ marginBottom: "1.2rem" }}>
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    justifyContent: "end",
                                    gap: "0.5rem",
                                    marginBottom: "0.4rem",
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={openCreateAdminModal}
                                    style={{
                                        padding: "0.3rem 0.7rem",
                                        borderRadius: "999px",
                                        border: "1px solid #d1d5db",
                                        backgroundColor: "#ffffff",
                                        fontSize: "0.8rem",
                                        cursor: "pointer",
                                    }}
                                >
                                    Legg til
                                </button>
                            </div>

                            {admins.length === 0 ? (
                                <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                                    Ingen administratorer funnet.
                                </p>
                            ) : (
                                <table
                                    style={{
                                        width: "100%",
                                        borderCollapse: "collapse",
                                        fontSize: "0.85rem",
                                    }}
                                >
                                    <thead>
                                    <tr>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                                cursor: "pointer",
                                            }}
                                            onClick={() => toggleAdminSort("name")}
                                        >
                                            Navn{" "}
                                            {adminSortKey === "name" &&
                                                (adminSortDir === "asc" ? "▲" : "▼")}
                                        </th>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                                cursor: "pointer",
                                            }}
                                            onClick={() => toggleAdminSort("email")}
                                        >
                                            E-post{" "}
                                            {adminSortKey === "email" &&
                                                (adminSortDir === "asc" ? "▲" : "▼")}
                                        </th>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                                cursor: "pointer",
                                            }}
                                            onClick={() => toggleAdminSort("phone")}
                                        >
                                            Mobil{" "}
                                            {adminSortKey === "phone" &&
                                                (adminSortDir === "asc" ? "▲" : "▼")}
                                        </th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {admins.map((u) => (
                                        <tr
                                            key={u.docId}
                                            onClick={() => openEditAdminModal(u)}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.displayName}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.email}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                            >
                                                {u.phone ?? "—"}
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* LÆRER-MODAL */}
            {teacherModalMode && (
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
                >
                    <div
                        style={{
                            width: "100%",
                            maxWidth: "420px",
                            backgroundColor: "#ffffff",
                            borderRadius: "1rem",
                            padding: "1rem 1.25rem",
                            boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
                        }}
                    >
                        <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                            {teacherModalMode === "create" ? "Ny lærer" : "Rediger lærer"}
                        </h3>
                        <p
                            style={{
                                marginTop: 0,
                                marginBottom: "0.9rem",
                                fontSize: "0.8rem",
                                color: "#6b7280",
                            }}
                        >
                            {teacherModalMode === "create"
                                ? "Opprett ny lærer, velg hvilke terminer de kan registrere for og lagre."
                                : "Endre navn, e-post, mobil, rolle og hvilke terminer læreren kan undervise på."}
                        </p>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                marginBottom: "0.75rem",
                            }}
                        >
                            <label style={{ fontSize: "0.8rem" }}>
                                Navn
                                <input
                                    type="text"
                                    value={editTeacherName}
                                    onChange={(e) => setEditTeacherName(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                E-post
                                <input
                                    type="email"
                                    value={editTeacherEmail}
                                    onChange={(e) => setEditTeacherEmail(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                Mobil
                                <input
                                    type="tel"
                                    value={editTeacherPhone}
                                    onChange={(e) => setEditTeacherPhone(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                Rolle
                                <select
                                    value={editTeacherRole}
                                    onChange={(e) =>
                                        setEditTeacherRole(
                                            e.target.value as "student" | "teacher" | "admin"
                                        )
                                    }
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                >
                                    <option value="teacher">Lærer</option>
                                    <option value="student">Student</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </label>

                            <div style={{ fontSize: "0.8rem" }}>
                                <div style={{ marginBottom: "0.25rem" }}>
                                    Termin(er) læreren kan registrere for:
                                </div>
                                <div
                                    style={{
                                        maxHeight: "150px",
                                        overflowY: "auto",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #e5e7eb",
                                        padding: "0.35rem 0.45rem",
                                    }}
                                >
                                    {TERM_OPTIONS.map((opt) => (
                                        <label
                                            key={opt.value}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "0.35rem",
                                                fontSize: "0.8rem",
                                                padding: "0.15rem 0",
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={editTeacherAllowedTerms.includes(opt.value)}
                                                onChange={() =>
                                                    toggleAllowedTermInTeacherModal(opt.value)
                                                }
                                            />
                                            <span>{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: "0.5rem",
                                marginTop: "0.5rem",
                            }}
                        >
                            <button
                                type="button"
                                onClick={closeTeacherModal}
                                style={{
                                    padding: "0.3rem 0.7rem",
                                    borderRadius: "999px",
                                    border: "1px solid #d1d5db",
                                    backgroundColor: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                }}
                            >
                                Avbryt
                            </button>
                            <button
                                type="button"
                                onClick={
                                    teacherModalMode === "create"
                                        ? handleSaveCreateTeacher
                                        : handleSaveEditTeacher
                                }
                                style={{
                                    padding: "0.3rem 0.9rem",
                                    borderRadius: "999px",
                                    border: "none",
                                    backgroundColor: "#16a34a",
                                    color: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                }}
                            >
                                {teacherModalMode === "create" ? "Opprett lærer" : "Lagre"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* STUDENT-MODAL */}
            {studentModalMode && (
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
                >
                    <div
                        style={{
                            width: "100%",
                            maxWidth: "420px",
                            backgroundColor: "#ffffff",
                            borderRadius: "1rem",
                            padding: "1rem 1.25rem",
                            boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
                        }}
                    >
                        <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                            {studentModalMode === "create" ? "Ny student" : "Rediger student"}
                        </h3>
                        <p
                            style={{
                                marginTop: 0,
                                marginBottom: "0.9rem",
                                fontSize: "0.8rem",
                                color: "#6b7280",
                            }}
                        >
                            {studentModalMode === "create"
                                ? "Opprett ny student og velg termin."
                                : "Endre navn, e-post, mobil, rolle og termin."}
                        </p>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                marginBottom: "0.75rem",
                            }}
                        >
                            <label style={{ fontSize: "0.8rem" }}>
                                Navn
                                <input
                                    type="text"
                                    value={editStudentName}
                                    onChange={(e) => setEditStudentName(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                E-post
                                <input
                                    type="email"
                                    value={editStudentEmail}
                                    onChange={(e) => setEditStudentEmail(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                Mobil
                                <input
                                    type="tel"
                                    value={editStudentPhone}
                                    onChange={(e) => setEditStudentPhone(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                Rolle
                                <select
                                    value={editStudentRole}
                                    onChange={(e) =>
                                        setEditStudentRole(
                                            e.target.value as "student" | "teacher" | "admin"
                                        )
                                    }
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                >
                                    <option value="student">Student</option>
                                    <option value="teacher">Lærer</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                Termin
                                <select
                                    value={editStudentTerm ?? ""}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setEditStudentTerm(val === "" ? null : parseInt(val, 10));
                                    }}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                >
                                    <option value="">Ingen</option>
                                    {TERM_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: "0.5rem",
                                marginTop: "0.5rem",
                            }}
                        >
                            <button
                                type="button"
                                onClick={closeStudentModal}
                                style={{
                                    padding: "0.3rem 0.7rem",
                                    borderRadius: "999px",
                                    border: "1px solid #d1d5db",
                                    backgroundColor: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                }}
                            >
                                Avbryt
                            </button>
                            <button
                                type="button"
                                onClick={
                                    studentModalMode === "create"
                                        ? handleSaveCreateStudent
                                        : handleSaveEditStudent
                                }
                                style={{
                                    padding: "0.3rem 0.9rem",
                                    borderRadius: "999px",
                                    border: "none",
                                    backgroundColor: "#16a34a",
                                    color: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                }}
                            >
                                {studentModalMode === "create" ? "Opprett student" : "Lagre"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ADMIN-MODAL */}
            {adminModalMode && (
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
                >
                    <div
                        style={{
                            width: "100%",
                            maxWidth: "420px",
                            backgroundColor: "#ffffff",
                            borderRadius: "1rem",
                            padding: "1rem 1.25rem",
                            boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
                        }}
                    >
                        <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                            {adminModalMode === "create" ? "Ny admin" : "Rediger admin"}
                        </h3>
                        <p
                            style={{
                                marginTop: 0,
                                marginBottom: "0.9rem",
                                fontSize: "0.8rem",
                                color: "#6b7280",
                            }}
                        >
                            {adminModalMode === "create"
                                ? "Opprett ny admin."
                                : "Endre navn, e-post, mobil og rolle."}
                        </p>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                marginBottom: "0.75rem",
                            }}
                        >
                            <label style={{ fontSize: "0.8rem" }}>
                                Navn
                                <input
                                    type="text"
                                    value={editAdminName}
                                    onChange={(e) => setEditAdminName(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                E-post
                                <input
                                    type="email"
                                    value={editAdminEmail}
                                    onChange={(e) => setEditAdminEmail(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                Mobil
                                <input
                                    type="tel"
                                    value={editAdminPhone}
                                    onChange={(e) => setEditAdminPhone(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                />
                            </label>

                            <label style={{ fontSize: "0.8rem" }}>
                                Rolle
                                <select
                                    value={editAdminRole}
                                    onChange={(e) =>
                                        setEditAdminRole(
                                            e.target.value as "student" | "teacher" | "admin"
                                        )
                                    }
                                    style={{
                                        width: "100%",
                                        padding: "0.3rem 0.45rem",
                                        borderRadius: "0.5rem",
                                        border: "1px solid #d1d5db",
                                        fontSize: "0.85rem",
                                        marginTop: "0.15rem",
                                    }}
                                >
                                    <option value="admin">Admin</option>
                                    <option value="teacher">Lærer</option>
                                    <option value="student">Student</option>
                                </select>
                            </label>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: "0.5rem",
                                marginTop: "0.5rem",
                            }}
                        >
                            <button
                                type="button"
                                onClick={closeAdminModal}
                                style={{
                                    padding: "0.3rem 0.7rem",
                                    borderRadius: "999px",
                                    border: "1px solid #d1d5db",
                                    backgroundColor: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                }}
                            >
                                Avbryt
                            </button>
                            <button
                                type="button"
                                onClick={
                                    adminModalMode === "create"
                                        ? handleSaveCreateAdmin
                                        : handleSaveEditAdmin
                                }
                                style={{
                                    padding: "0.3rem 0.9rem",
                                    borderRadius: "999px",
                                    border: "none",
                                    backgroundColor: "#16a34a",
                                    color: "#ffffff",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                }}
                            >
                                {adminModalMode === "create" ? "Opprett admin" : "Lagre"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
// ---------- Termin-oppsett ----------

const TermSetup: React.FC = () => {
    type Requirement = {
        id: string;
        category: string;
        requiredCount: number;
        term: number;
    };

    const [requirements, setRequirements] = useState<Requirement[]>([]);
    const [selectedTerm, setSelectedTerm] = useState<number | "">("");

    const [times, setTimes] = useState<TimeDef[]>([]);
    const [loading, setLoading] = useState(true);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [newTimeNameByReq, setNewTimeNameByReq] = useState<Record<string, string>>({});
    const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
    const [editingTimeName, setEditingTimeName] = useState<string>("");
    const [editingCategory, setEditingCategory] = useState("");
    const [editingReqId, setEditingReqId] = useState<string | null>(null);
    const [editingRequiredCount, setEditingRequiredCount] = useState<number>(0);

    useEffect(() => {
        const loadAll = async () => {
            try {
                setLoading(true);
                const [reqSnap, timesSnap] = await Promise.all([
                    getDocs(collection(db, "requirements")),
                    getDocs(collection(db, "times")),
                ]);

                const reqs: Requirement[] = reqSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        term: data.term,
                        category: data.category,
                        requiredCount: data.requiredCount ?? 0,
                    };
                });

                const ts: TimeDef[] = timesSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        name: data.name,
                        category: data.category,
                        term: data.term,
                    };
                });

                setRequirements(reqs);
                setTimes(ts);
            } catch (err) {
                console.error("Feil ved lasting av termin-oppsett:", err);
            } finally {
                setLoading(false);
            }
        };

        void loadAll();
    }, []);

    const requirementsForTerm = requirements
        .filter((r) => r.term === selectedTerm)
        .sort((a, b) =>
            a.category.localeCompare(b.category, "nb-NO", { sensitivity: "base" })
        );

    const handleRenameTime = async (time: TimeDef) => {
        const newName = editingTimeName.trim();
        if (!newName || newName === time.name) {
            // Ingenting å oppdatere
            setEditingTimeId(null);
            setEditingTimeName("");
            return;
        }

        try {
            await updateDoc(doc(db, "times", time.id), { name: newName });
            setTimes((prev) =>
                prev.map((t) => (t.id === time.id ? { ...t, name: newName } : t))
            );
            setEditingTimeId(null);
            setEditingTimeName("");
        } catch (err) {
            console.error("Feil ved endring av timenavn:", err);
            alert("Kunne ikke oppdatere navn på timen.");
        }
    };

    const timesForTerm = times.filter((t) => t.term === selectedTerm);

    const startEditRequirement = (req: RequirementDoc) => {
        setEditingReqId(req.id);
        setEditingCategory(req.category);
        setEditingRequiredCount(req.requiredCount ?? 0);
    };

    const cancelEditRequirement = () => {
        setEditingReqId(null);
    };

    const handleSaveRequirement = async (req: RequirementDoc) => {
        if (!editingReqId) return;

        const oldCategory = req.category;
        const newName = (editingCategory || "").trim() || oldCategory;

        // Finn totalt antall timer i denne gruppen (for denne terminen)
        const totalInGroup = times.filter(
            (t) => t.term === req.term && t.category === oldCategory
        ).length;

        let newRequired = editingRequiredCount;
        if (Number.isNaN(newRequired) || newRequired < 0) newRequired = 0;
        if (totalInGroup > 0 && newRequired > totalInGroup) {
            newRequired = totalInGroup;
        }

        // Sjekk om kategori-navn allerede finnes denne terminen
        const exists = requirementsForTerm.find(
            (r) =>
                r.id !== req.id &&
                r.category.toLowerCase() === newName.toLowerCase()
        );
        if (exists) {
            alert("Det finnes allerede en gruppe med dette navnet i valgt termin.");
            return;
        }

        try {
            const batch = writeBatch(db);

            // Oppdater requirement (navn + krav)
            const reqRef = doc(db, "requirements", req.id);
            batch.update(reqRef, {
                category: newName,
                requiredCount: newRequired,
            });

            // Oppdater alle times i denne gruppen/termin
            const timesQ = query(
                collection(db, "times"),
                where("term", "==", req.term),
                where("category", "==", oldCategory)
            );
            const timesSnap = await getDocs(timesQ);
            timesSnap.forEach((d) => {
                batch.update(d.ref, { category: newName });
            });

            // Oppdater alle sessions i denne gruppen/termin
            const sessionsQ = query(
                collection(db, "sessions"),
                where("term", "==", req.term),
                where("category", "==", oldCategory)
            );
            const sessionsSnap = await getDocs(sessionsQ);
            sessionsSnap.forEach((d) => {
                batch.update(d.ref, { category: newName });
            });

            await batch.commit();

            // Oppdater lokal state
            setRequirements((prev) =>
                prev.map((r) =>
                    r.id === req.id
                        ? { ...r, category: newName, requiredCount: newRequired }
                        : r
                )
            );

            setTimes((prev) =>
                prev.map((t) =>
                    t.term === req.term && t.category === oldCategory
                        ? { ...t, category: newName }
                        : t
                )
            );

            setEditingReqId(null);
        } catch (err) {
            console.error("Feil ved lagring av gruppe:", err);
            alert("Kunne ikke lagre endringene for gruppen.");
        }
    };

    const handleAddCategory = async () => {
        const name = newCategoryName.trim();
        if (!name) return;

        const exists = requirementsForTerm.some(
            (r) => r.category.toLowerCase() === name.toLowerCase()
        );
        if (exists) {
            alert("Denne gruppen finnes allerede for valgt termin.");
            return;
        }

        try {
            const ref = await addDoc(collection(db, "requirements"), {
                term: selectedTerm,
                category: name,
                requiredCount: 0,
            });
            setRequirements((prev) => [
                ...prev,
                {
                    id: ref.id,
                    term: selectedTerm,
                    category: name,
                    requiredCount: 0,
                },
            ]);
            setNewCategoryName("");
        } catch (err) {
            console.error("Feil ved oppretting av kategori:", err);
            alert("Kunne ikke opprette kategori.");
        }
    };

    const handleUpdateRequiredCount = async (req: Requirement, value: number) => {
        try {
            await updateDoc(doc(db, "requirements", req.id), {
                requiredCount: value,
            });
            setRequirements((prev) =>
                prev.map((r) =>
                    r.id === req.id ? { ...r, requiredCount: value } : r
                )
            );
        } catch (err) {
            console.error("Feil ved oppdatering av krav:", err);
            alert("Kunne ikke oppdatere krav.");
        }
    };

    const handleDeleteCategory = async (id: string) => {
        if (!window.confirm("Er du sikker på at du vil slette denne gruppen for terminen?")) {
            return;
        }

        try {
            await deleteDoc(doc(db, "requirements", id));
            setRequirements((prev) => prev.filter((r) => r.id !== id));
        } catch (err) {
            console.error("Feil ved sletting av krav:", err);
            alert("Kunne ikke slette gruppen.");
        }
    };

    const handleAddTime = async (req: Requirement) => {
        const key = req.id;
        const name = (newTimeNameByReq[key] ?? "").trim();
        if (!name) return;

        try {
            const ref = await addDoc(collection(db, "times"), {
                term: selectedTerm,
                category: req.category,
                name,
            });
            setTimes((prev) => [
                ...prev,
                {
                    id: ref.id,
                    term: selectedTerm,
                    category: req.category,
                    name,
                },
            ]);
            setNewTimeNameByReq((prev) => ({ ...prev, [key]: "" }));
        } catch (err) {
            console.error("Feil ved oppretting av time:", err);
            alert("Kunne ikke opprette time.");
        }
    };

    const handleDeleteTime = async (time: TimeDef) => {
        const sure = window.confirm(
            `Slette timen "${time.name}" fra ${termLabel(time.term)}? Historiske sesjoner beholdes, men timen forsvinner fra admin-oppsettet.`
        );
        if (!sure) return;

        try {
            await deleteDoc(doc(db, "times", time.id));
            setTimes((prev) => prev.filter((t) => t.id !== time.id));
        } catch (err) {
            console.error("Feil ved sletting av time:", err);
            alert("Kunne ikke slette time.");
        }
    };

    if (loading) {
        return <p>Laster termin-oppsett...</p>;
    }

    return (
        <section style={{ marginBottom: "2rem" }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    marginBottom: "0.75rem",
                }}
            >
                <select
                    value={selectedTerm}
                    onChange={(e) => {
                        const v = e.target.value;
                        setSelectedTerm(v === "" ? "" : parseInt(v, 10));
                    }}
                    style={{
                        padding: "0.25rem 0.5rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #d1d5db",
                    }}
                >
                    <option value="" disabled>
                        Velg termin
                    </option>
                    {TERM_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                <input
                    type="text"
                    placeholder="Ny gruppe..."
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    style={{
                        flex: 1,
                        padding: "0.35rem 0.5rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #d1d5db",
                    }}
                />
                <button
                    type="button"
                    onClick={handleAddCategory}
                    style={{
                        padding: "0.35rem 0.9rem",
                        borderRadius: "999px",
                        border: "none",
                        backgroundColor: "#dc2626",
                        color: "#ffffff",
                        fontSize: "0.9rem",
                        cursor: "pointer",
                    }}
                >
                    Legg til gruppe
                </button>
            </div>

            {requirementsForTerm.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                    Ingen grupper definert ennå for {termLabel(selectedTerm)}.
                </p>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {requirementsForTerm.map((req) => {
                        const key = req.id;
                        const catTimes = timesForTerm
                            .filter((t) => t.category === req.category)
                            .sort((a, b) => {
                                const na = leadingNumberFromName(a.name);
                                const nb = leadingNumberFromName(b.name);
                                if (na !== nb) return na - nb;
                                return a.name.localeCompare(b.name, "nb-NO", {
                                    sensitivity: "base",
                                });
                            });
                        const newTimeName = newTimeNameByReq[key] ?? "";
                        const totalInGroup = timesForTerm.filter(
                            (t) => t.category === req.category
                        ).length;
                        const isEditingReq = editingReqId === req.id;

                        return (
                            <div
                                key={req.id}
                                style={{
                                    borderRadius: "0.75rem",
                                    border: "1px solid #e5e7eb",
                                    padding: "0.75rem 0.75rem",
                                    backgroundColor: "#f9fafb",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginBottom: "0.5rem",
                                        gap: "0.5rem",
                                        flexWrap: "wrap",
                                    }}
                                >
                                    {/* VENSTRESIDE: navn + krav */}
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                            flexWrap: "wrap",
                                        }}
                                    >
                                        {isEditingReq ? (
                                            <>
                                                {/* Redigerbart gruppenavn */}
                                                <input
                                                    type="text"
                                                    value={editingCategory}
                                                    onChange={(e) => setEditingCategory(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            void handleSaveRequirement(req);
                                                        } else if (e.key === "Escape") {
                                                            cancelEditRequirement();
                                                        }
                                                    }}
                                                    autoFocus
                                                    style={{
                                                        minWidth: "12rem",
                                                        padding: "0.2rem 0.35rem",
                                                        borderRadius: "0.4rem",
                                                        border: "1px solid #d1d5db",
                                                        fontSize: "0.9rem",
                                                    }}
                                                />

                                                {/* Redigerbart krav (0–totalInGroup) */}
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "0.25rem",
                                                    }}
                                                >
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={totalInGroup}
                                                        value={editingRequiredCount}
                                                        onChange={(e) => {
                                                            const val = parseInt(e.target.value, 10);
                                                            setEditingRequiredCount(
                                                                Number.isNaN(val) ? 0 : val
                                                            );
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") {
                                                                void handleSaveRequirement(req);
                                                            } else if (e.key === "Escape") {
                                                                cancelEditRequirement();
                                                            }
                                                        }}
                                                        style={{
                                                            width: "4rem",
                                                            padding: "0.2rem 0.35rem",
                                                            borderRadius: "0.4rem",
                                                            border: "1px solid #d1d5db",
                                                            fontSize: "0.9rem",
                                                            textAlign: "center",
                                                        }}
                                                    />
                                                    <span
                                                        style={{
                                                            fontSize: "0.8rem",
                                                            color: "#6b7280",
                                                        }}
                                                    >
                                / {totalInGroup}
                            </span>
                                                </div>
                                            </>
                                        ) : (
                                            <div
                                                style={{
                                                    fontWeight: 600,
                                                    fontSize: "0.95rem",
                                                }}
                                            >
                                                {req.category} ({req.requiredCount}/{totalInGroup})
                                            </div>
                                        )}
                                    </div>

                                    {/* HØYRESIDE: knapper */}
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        {/* Endre / Lagre gruppe */}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                isEditingReq
                                                    ? void handleSaveRequirement(req)
                                                    : startEditRequirement(req)
                                            }
                                            style={{
                                                padding: "0.25rem 0.6rem",
                                                borderRadius: "999px",
                                                border: "none",
                                                backgroundColor: "#e5e7eb",
                                                color: "#111827",
                                                fontSize: "0.75rem",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {isEditingReq ? "Lagre" : "Endre gruppe"}
                                        </button>

                                        {/* Slett gruppe */}
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteCategory(req.id)}
                                            style={{
                                                padding: "0.25rem 0.6rem",
                                                borderRadius: "999px",
                                                border: "none",
                                                backgroundColor: "#fee2e2",
                                                color: "#991b1b",
                                                fontSize: "0.75rem",
                                                cursor: "pointer",
                                            }}
                                        >
                                            Slett gruppe
                                        </button>
                                    </div>
                                </div>

                                {catTimes.length > 0 ? (
                                    <ul
                                        style={{
                                            listStyle: "none",
                                            paddingLeft: 0,
                                            margin: "0 0 0.5rem 0",
                                            fontSize: "0.85rem",
                                        }}
                                    >
                                        {catTimes.map((t) => {
                                            const isEditing = editingTimeId === t.id;

                                            return (
                                                <li
                                                    key={t.id}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        padding: "0.15rem 0",
                                                        borderBottom: "1px dashed #e5e7eb",
                                                        gap: "0.5rem",
                                                    }}
                                                >
                                                    <div style={{ flex: 1 }}>
                                                        {isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={editingTimeName}
                                                                onChange={(e) => setEditingTimeName(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") {
                                                                        void handleRenameTime(t);
                                                                    } else if (e.key === "Escape") {
                                                                        setEditingTimeId(null);
                                                                        setEditingTimeName("");
                                                                    }
                                                                }}
                                                                autoFocus
                                                                style={{
                                                                    width: "100%",
                                                                    padding: "0.2rem 0.35rem",
                                                                    borderRadius: "0.4rem",
                                                                    border: "1px solid #d1d5db",
                                                                    fontSize: "0.85rem",
                                                                }}
                                                            />
                                                        ) : (
                                                            <span>{t.name}</span>
                                                        )}
                                                    </div>

                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: "0.35rem",
                                                        }}
                                                    >
                                                        {/* Endre / Lagre-knapp */}
                                                        {isEditing ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleRenameTime(t)}
                                                                style={{
                                                                    padding: "0.15rem 0.45rem",
                                                                    borderRadius: "999px",
                                                                    border: "none",
                                                                    backgroundColor: "#e5e7eb",
                                                                    color: "#111827",
                                                                    fontSize: "0.75rem",
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                Lagre
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingTimeId(t.id);
                                                                    setEditingTimeName(t.name);
                                                                }}
                                                                style={{
                                                                    padding: "0.15rem 0.45rem",
                                                                    borderRadius: "999px",
                                                                    border: "none",
                                                                    backgroundColor: "#e5e7eb",
                                                                    color: "#111827",
                                                                    fontSize: "0.75rem",
                                                                    cursor: "pointer",
                                                                }}
                                                            >
                                                                Endre
                                                            </button>
                                                        )}

                                                        {/* Slett-knapp */}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteTime(t)}
                                                            style={{
                                                                padding: "0.15rem 0.45rem",
                                                                borderRadius: "999px",
                                                                border: "none",
                                                                backgroundColor: "#fee2e2",
                                                                color: "#b91c1c",
                                                                fontSize: "0.75rem",
                                                                cursor: "pointer",
                                                            }}
                                                        >
                                                            Slett
                                                        </button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : (
                                    <p
                                        style={{
                                            margin: "0 0 0.5rem 0",
                                            fontSize: "0.8rem",
                                            color: "#9ca3af",
                                        }}
                                    >
                                        Ingen timer lagt til i denne gruppen.
                                    </p>
                                )}

                                <div
                                    style={{
                                        display: "flex",
                                        gap: "0.5rem",
                                        marginTop: "0.25rem",
                                    }}
                                >
                                    <input
                                        type="text"
                                        placeholder="Ny time..."
                                        value={newTimeName}
                                        onChange={(e) =>
                                            setNewTimeNameByReq((prev) => ({
                                                ...prev,
                                                [key]: e.target.value,
                                            }))
                                        }
                                        style={{
                                            flex: 1,
                                            padding: "0.3rem 0.5rem",
                                            borderRadius: "0.5rem",
                                            border: "1px solid #d1d5db",
                                            fontSize: "0.85rem",
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleAddTime(req)}
                                        style={{
                                            padding: "0.35rem 0.8rem",
                                            borderRadius: "999px",
                                            border: "none",
                                            backgroundColor: "#4b5563",
                                            color: "#ffffff",
                                            fontSize: "0.8rem",
                                            cursor: "pointer",
                                        }}
                                    >
                                        Legg til time
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};


// ---------- Hoved AdminPage med gamle knappe-struktur ----------

const AdminPage: React.FC = () => {
    const { user, loading } = useAuth();
    const [mainTab, setMainTab] = useState<"setup" | "users" | "teacherView">(
        "setup"
    );

    if (loading) {
        return (
            <div
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f5f5f7",
                }}
            >
                <div
                    style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "999px",
                        border: "3px solid #e5e7eb",
                        borderTopColor: "#dc2626",
                        animation: "spin 1s linear infinite",
                    }}
                />
            </div>
        );
    }

    if (!user || user.role !== "admin") {
        return (
            <div
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f5f5f7",
                    padding: "1.5rem",
                }}
            >
                <div className="page-card page-card--admin">
                    <h2>Ingen tilgang</h2>
                    <p>Du må være logget inn som administrator for å se denne siden.</p>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                background: "#f5f5f7",
                padding: "1.5rem 1rem",
            }}
        >
            <div className="page-card page-card--admin">
                <header
                    style={{
                        marginBottom: "1rem",
                        borderBottom: "1px solid #e5e7eb",
                        paddingBottom: "0.75rem",
                    }}
                >
                    <h2 style={{ margin: 0 }}>Adminpanel</h2>
                    <p
                        style={{
                            margin: "0.25rem 0 0.75rem",
                            fontSize: "0.85rem",
                            color: "#6b7280",
                        }}
                    >
                        Oppsett av krav per termin, administrasjon av brukere og
                        forhåndsvisning for lærere.
                    </p>

                    {/* Øverste knapper: Oppsett / Brukere */}
                    <div
                        style={{
                            display: "flex",
                            gap: "0.5rem",
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setMainTab("setup")}
                            style={{
                                flex: 1,
                                padding: "0.35rem 0.5rem",
                                borderRadius: "999px",
                                border: "1px solid #e5e7eb",
                                background:
                                    mainTab === "setup" ? "#b91c1c" : "#ffffff",
                                color: mainTab === "setup" ? "#ffffff" : "#111827",
                                fontSize: "0.85rem",
                                cursor: "pointer",
                            }}
                        >
                            Oppmøtebøker
                        </button>
                        <button
                            type="button"
                            onClick={() => setMainTab("users")}
                            style={{
                                flex: 1,
                                padding: "0.35rem 0.5rem",
                                borderRadius: "999px",
                                border: "1px solid #e5e7eb",
                                background:
                                    mainTab === "users" ? "#b91c1c" : "#ffffff",
                                color: mainTab === "users" ? "#ffffff" : "#111827",
                                fontSize: "0.85rem",
                                cursor: "pointer",
                            }}
                        >
                            Brukere
                        </button>
                    </div>
                </header>

                {mainTab === "setup" && <TermSetup />}
                {mainTab === "users" && <UsersAdmin />}
                {mainTab === "teacherView" && <TeacherPreview />}
            </div>
        </div>
    );
};

export default AdminPage;