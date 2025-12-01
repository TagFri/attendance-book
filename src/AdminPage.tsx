import React, { useEffect, useMemo, useRef, useState } from "react";
import LoadingSpinner from "./LoadingSpinner";
import { useAuth } from "./hooks/useAuth";
import { auth, db, secondaryAuth } from "./firebase";
// import { signOut } from "firebase/auth";
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
    getDoc,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { labelFromTerm, shortLabelFromTerm } from "./terms";
import ProfileModal from "./ProfileModal";
import { getFunctions, httpsCallable } from "firebase/functions";

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

    // --- Term options loaded from Firestore (for filters and modals) ---
    type TermDocOption = { value: number; label: string; order?: number };
    const [dbTerms, setDbTerms] = useState<TermDocOption[]>([]);
    const computedTermOptions = useMemo(() => {
        return dbTerms
            .slice()
            .sort((a, b) => (a.order ?? a.value) - (b.order ?? b.value))
            .map((t) => ({ value: t.value, label: t.label || `Termin ${t.value}` }));
    }, [dbTerms]);
    useEffect(() => {
        const loadTerms = async () => {
            try {
                const snap = await getDocs(collection(db, "terms"));
                const list: TermDocOption[] = snap.docs
                    .map((d) => {
                        const data = d.data() as any;
                        const value = typeof data?.value === "number" ? data.value : undefined;
                        if (typeof value !== "number") return null;
                        const label = typeof data?.label === "string" ? data.label : "";
                        const order = typeof data?.order === "number" ? data.order : undefined;
                        return { value, label, order } as TermDocOption;
                    })
                    .filter(Boolean) as TermDocOption[];
                list.sort((a, b) => (a.order ?? a.value) - (b.order ?? b.value));
                setDbTerms(list);
            } catch (e) {
                console.warn("Kunne ikke laste terminer fra Firestore for admin-brukerpanel:", e);
            }
        };
        void loadTerms();
    }, []);

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
    const [approvalTermSel, setApprovalTermSel] = useState<number | null>(null);

    // Godkjenning av bøker per student per termin (cache i minnet)
    type BookApproval = { approved: boolean; approvedAt?: Timestamp | null };
    const [bookApprovals, setBookApprovals] = useState<
        Record<string, Record<number, BookApproval>>
    >({});

    const getCachedApproval = (uid: string, term: number | null | undefined): BookApproval | undefined => {
        if (uid && term != null) {
            return bookApprovals[uid]?.[term];
        }
        return undefined;
    };

    const loadApproval = async (uid: string, term: number | null | undefined) => {
        if (!uid || term == null) return;
        // Unngå dobbel lasting
        if (bookApprovals[uid]?.[term] !== undefined) return;
        try {
            const ref = doc(db, "users", uid, "books", String(term));
            const snap = await getDoc(ref);
            const data: BookApproval = snap.exists()
                ? {
                    approved: Boolean((snap.data() as any).approved),
                    approvedAt: (snap.data() as any).approvedAt ?? null,
                }
                : { approved: false, approvedAt: null };

            setBookApprovals((prev) => ({
                ...prev,
                [uid]: {
                    ...(prev[uid] ?? {}),
                    [term]: data,
                },
            }));
        } catch (e) {
            console.error("Kunne ikke laste godkjenning for bok:", e);
        }
    };

    const approveBook = async (uid: string, term: number | null | undefined) => {
        if (!uid || term == null) return;
        try {
            const ref = doc(db, "users", uid, "books", String(term));
            await setDoc(ref, { approved: true, approvedAt: serverTimestamp() }, { merge: true });
            // Optimistisk oppdatering
            setBookApprovals((prev) => ({
                ...prev,
                [uid]: {
                    ...(prev[uid] ?? {}),
                    [term]: { approved: true, approvedAt: Timestamp.now() },
                },
            }));
        } catch (e) {
            console.error("Feil ved godkjenning av bok:", e);
            alert("Kunne ikke godkjenne bok.");
        }
    };

    const unapproveBook = async (uid: string, term: number | null | undefined) => {
        if (!uid || term == null) return;
        try {
            const ref = doc(db, "users", uid, "books", String(term));
            await setDoc(ref, { approved: false, approvedAt: null }, { merge: true });
            setBookApprovals((prev) => ({
                ...prev,
                [uid]: {
                    ...(prev[uid] ?? {}),
                    [term]: { approved: false, approvedAt: null },
                },
            }));
        } catch (e) {
            console.error("Feil ved oppheving av godkjenning:", e);
            alert("Kunne ikke oppheve godkjenning.");
        }
    };

    // Liten hjelpekomponent for å vise status i tabellen
    const StudentApprovalStatus: React.FC<{ uid: string; term: number }> = ({ uid, term }) => {
        const approval = getCachedApproval(uid, term);
        useEffect(() => {
            if (approval === undefined) void loadApproval(uid, term);
        }, [uid, term, approval]);

        if (!approval) return <span style={{ color: "#9ca3af" }}>—</span>;
        if (approval.approved) {
            const ts = approval.approvedAt as Timestamp | null | undefined;
            const title = ts ? new Date(ts.toDate()).toLocaleString("nb-NO") : undefined;
            return (
                <span title={title} style={{ color: "#16a34a", fontSize: "1rem" }}>✅</span>
            );
        }
        return <span style={{ color: "#9ca3af" }}>—</span>;
    };

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
                uid,
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
            // If email changed, update in Auth via callable before Firestore
            if (editTeacherEmail.trim() && editTeacherEmail.trim() !== (teacherModalUser.email || "")) {
                try {
                    const functions = getFunctions(undefined, "europe-west1");
                    const updateAuthEmail = httpsCallable(functions, "adminUpdateUserEmail");
                    await updateAuthEmail({ uid: docId, newEmail: editTeacherEmail.trim() });
                } catch (e: any) {
                    console.error("adminUpdateUserEmail failed", e);
                    alert("Kunne ikke oppdatere lærerens e‑post i Auth. Endringen er avbrutt. Kontroller at Cloud Function 'adminUpdateUserEmail' er deployet og at du har tilgang.");
                    return;
                }
            }
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
                uid,
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
            if (editStudentEmail.trim() && editStudentEmail.trim() !== (studentModalUser.email || "")) {
                try {
                    const functions = getFunctions(undefined, "europe-west1");
                    const updateAuthEmail = httpsCallable(functions, "adminUpdateUserEmail");
                    await updateAuthEmail({ uid: docId, newEmail: editStudentEmail.trim() });
                } catch (e: any) {
                    console.error("adminUpdateUserEmail failed", e);
                    alert("Kunne ikke oppdatere studentens e‑post i Auth. Endringen er avbrutt. Kontroller at Cloud Function 'adminUpdateUserEmail' er deployet og at du har tilgang.");
                    return;
                }
            }
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
                uid,
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
            if (editAdminEmail.trim() && editAdminEmail.trim() !== (adminModalUser.email || "")) {
                try {
                    const functions = getFunctions(undefined, "europe-west1");
                    const updateAuthEmail = httpsCallable(functions, "adminUpdateUserEmail");
                    await updateAuthEmail({ uid: docId, newEmail: editAdminEmail.trim() });
                } catch (e: any) {
                    console.error("adminUpdateUserEmail failed", e);
                    alert("Kunne ikke oppdatere admin‑e‑post i Auth. Endringen er avbrutt. Kontroller at Cloud Function 'adminUpdateUserEmail' er deployet og at du har tilgang.");
                    return;
                }
            }
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
                    onClick={() => setActiveTab("students")}
                    style={{
                        flex: 1,
                        padding: "0.35rem 0.5rem",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: activeTab === "students" ? "#6CE1AB" : "#ffffff",
                        color: activeTab === "students" ? "black" : "#111827",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                    }}
                >
                    Studenter
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("teachers")}
                    style={{
                        flex: 1,
                        padding: "0.35rem 0.5rem",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: activeTab === "teachers" ? "#6CE1AB" : "#ffffff",
                        color: activeTab === "teachers" ? "black" : "#111827",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                    }}
                >
                    Lærere
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("admins")}
                    style={{
                        flex: 1,
                        padding: "0.35rem 0.5rem",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        background: activeTab === "admins" ? "#6CE1AB" : "#ffffff",
                        color: activeTab === "admins" ? "black" : "#111827",
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
                <LoadingSpinner />
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
                                            {computedTermOptions.map((opt) => (
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
                                            {computedTermOptions.map((opt) => (
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
                                            }}
                                        >
                                            Termin
                                        </th>
                                        <th
                                            style={{
                                                textAlign: "left",
                                                borderBottom: "1px solid #e5e7eb",
                                                padding: "0.25rem",
                                            }}
                                        >
                                            Godkjent?
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
                                                {u.term != null && u.term !== undefined
                                                    ? shortLabelFromTerm(computedTermOptions, u.term)
                                                    : "Ingen"}
                                            </td>
                                            <td
                                                style={{
                                                    padding: "0.25rem",
                                                    borderBottom: "1px solid #f3f4f6",
                                                }}
                                                onMouseEnter={(e) => {
                                                    // Forhåndslast godkjenning når raden hovres
                                                    void loadApproval(u.docId, u.term ?? null);
                                                }}
                                            >
                                                {u.term == null ? (
                                                    "—"
                                                ) : (
                                                    <StudentApprovalStatus
                                                        uid={u.docId}
                                                        term={u.term}
                                                    />
                                                )}
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
                                    {computedTermOptions.map((opt) => (
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
                                    {computedTermOptions.map((opt) => (
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
// ---------- Terminer (CRUD + drag & drop rekkefølge) ----------

const TermsAdmin: React.FC = () => {
    type TermDoc = { docId: string; value: number; label: string; order?: number };
    const [terms, setTerms] = useState<TermDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingLabel, setEditingLabel] = useState<string>("");
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [orderDirty, setOrderDirty] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                const snap = await getDocs(collection(db, "terms"));
                const list: TermDoc[] = snap.docs
                    .map((d) => {
                        const data = d.data() as any;
                        if (typeof data?.value !== "number") return null;
                        return {
                            docId: d.id,
                            value: data.value,
                            label: typeof data?.label === "string" ? data.label : "",
                            order: typeof data?.order === "number" ? data.order : undefined,
                        } as TermDoc;
                    })
                    .filter(Boolean) as TermDoc[];
                list.sort((a, b) => (a.order ?? a.value) - (b.order ?? b.value));
                setTerms(list);
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    const handleAdd = async () => {
        try {
            setAdding(true);
            const maxVal = terms.length > 0 ? Math.max(...terms.map((t) => t.value)) : 0;
            const maxOrder = terms.length > 0 ? Math.max(...terms.map((t) => t.order ?? t.value)) : 0;
            const newValue = maxVal + 1;
            const newOrder = maxOrder + 1;
            const ref = await addDoc(collection(db, "terms"), {
                value: newValue,
                label: "",
                order: newOrder,
                createdAt: serverTimestamp(),
            });
            const row: TermDoc = { docId: ref.id, value: newValue, label: "", order: newOrder };
            setTerms((prev) => [...prev, row]);
            setEditingId(ref.id);
            setEditingLabel("");
        } catch (e) {
            console.error("Kunne ikke legge til termin:", e);
            alert("Kunne ikke legge til termin.");
        } finally {
            setAdding(false);
        }
    };

    const handleSaveLabel = async (row: TermDoc) => {
        const newLabel = editingLabel.trim();
        if (!newLabel) {
            setEditingId(null);
            return;
        }
        try {
            await updateDoc(doc(db, "terms", row.docId), { label: newLabel, updatedAt: serverTimestamp() } as any);
            setTerms((prev) => prev.map((t) => (t.docId === row.docId ? { ...t, label: newLabel } : t)));
            setEditingId(null);
        } catch (e) {
            console.error("Kunne ikke lagre navn:", e);
            alert("Kunne ikke lagre navn på termin.");
        }
    };

    const handleDelete = async (row: TermDoc) => {
        const ok = window.confirm(
            `Slette termin «${row.label || row.value}»? Dette påvirker kun listen over terminer. Tilknyttede data endres ikke automatisk.`
        );
        if (!ok) return;
        try {
            await deleteDoc(doc(db, "terms", row.docId));
            setTerms((prev) => prev.filter((t) => t.docId !== row.docId));
            setOrderDirty(true);
        } catch (e) {
            console.error("Kunne ikke slette termin:", e);
            alert("Kunne ikke slette termin.");
        }
    };

    const reorder = (from: number, to: number) => {
        if (from === to) return;
        setTerms((prev) => {
            const arr = prev.slice();
            const [moved] = arr.splice(from, 1);
            arr.splice(to, 0, moved);
            return arr;
        });
        setOrderDirty(true);
    };

    const handleSaveOrder = async () => {
        try {
            const batch = writeBatch(db);
            terms.forEach((t, idx) => {
                batch.update(doc(db, "terms", t.docId), { order: idx + 1 } as any);
            });
            await batch.commit();
            setOrderDirty(false);
        } catch (e) {
            console.error("Kunne ikke lagre rekkefølge:", e);
            alert("Kunne ikke lagre rekkefølge.");
        }
    };

    return (
        <section>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding}
                    style={{
                        padding: "0.45rem 0.9rem",
                        borderRadius: "999px",
                        border: "none",
                        backgroundColor: "#dc2626",
                        color: "#ffffff",
                        fontSize: "0.9rem",
                        cursor: adding ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                    }}
                >
                    {adding ? "Legger til..." : "Legg til termin"}
                </button>
                <button
                    type="button"
                    onClick={handleSaveOrder}
                    disabled={!orderDirty}
                    style={{
                        padding: "0.45rem 0.9rem",
                        borderRadius: "999px",
                        border: "1px solid #d1d5db",
                        backgroundColor: orderDirty ? "#ffffff" : "#f3f4f6",
                        color: "#111827",
                        fontSize: "0.9rem",
                        cursor: orderDirty ? "pointer" : "not-allowed",
                        whiteSpace: "nowrap",
                    }}
                >
                    Lagre rekkefølge
                </button>
            </div>

            {loading ? (
                <LoadingSpinner />)
                : terms.length === 0 ? (
                    <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>Ingen terminer opprettet ennå.</p>
                ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {terms.map((t, idx) => {
                            const isEditing = editingId === t.docId;
                            return (
                                <li
                                    key={t.docId}
                                    draggable
                                    onDragStart={() => setDragIndex(idx)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => {
                                        if (dragIndex != null) reorder(dragIndex, idx);
                                        setDragIndex(null);
                                    }}
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        padding: "0.5rem 0.6rem",
                                        border: "1px solid #e5e7eb",
                                        borderRadius: "0.5rem",
                                        background: "#ffffff",
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1, minWidth: 0 }}>
                                        <span style={{ width: 28, textAlign: "center", color: "#6b7280" }}>☰</span>
                                        <span style={{ width: 36, color: "#6b7280" }}>{idx + 1}</span>
                                        <span style={{ width: 48, color: "#374151", fontWeight: 600 }}>#{t.value}</span>
                                        {isEditing ? (
                                            <input
                                                value={editingLabel}
                                                onChange={(e) => setEditingLabel(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') { e.preventDefault(); void handleSaveLabel(t); }
                                                    if (e.key === 'Escape') { setEditingId(null); }
                                                }}
                                                placeholder="Navn på modul"
                                                style={{ flex: 1, minWidth: 0, padding: "0.35rem 0.5rem", border: "1px solid #d1d5db", borderRadius: "0.5rem" }}
                                            />
                                        ) : (
                                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {t.label || <span style={{ color: "#9ca3af" }}>(uten navn)</span>}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: "flex", gap: "0.4rem" }}>
                                        {isEditing ? (
                                            <button
                                                type="button"
                                                onClick={() => void handleSaveLabel(t)}
                                                style={{ padding: "0.25rem 0.6rem", borderRadius: "999px", border: "none", background: "#16a34a", color: "#fff", fontSize: "0.8rem", cursor: "pointer" }}
                                            >
                                                Lagre
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => { setEditingId(t.docId); setEditingLabel(t.label); }}
                                                style={{ padding: "0.25rem 0.6rem", borderRadius: "999px", border: "none", background: "#e5e7eb", color: "#111827", fontSize: "0.8rem", cursor: "pointer" }}
                                            >
                                                Endre
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void handleDelete(t)}
                                            style={{ padding: "0.25rem 0.6rem", borderRadius: "999px", border: "none", background: "#fee2e2", color: "#b91c1c", fontSize: "0.8rem", cursor: "pointer" }}
                                        >
                                            Slett
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
        </section>
    );
};
// ---------- Termin-oppsett ----------

const TermSetup: React.FC = () => {
    type Requirement = {
        id: string;
        category: string;
        requiredCount: number;
        term: number;
        order?: number;
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
    // Term label overrides (legacy fallback when no terms exist in DB)
    const [termLabelOverrides, setTermLabelOverrides] = useState<Record<number, string>>({});
    // Terms loaded from Firestore (replaces termConfig where available)
    type TermDoc = { docId: string; value: number; label: string; order?: number };
    const [terms, setTerms] = useState<TermDoc[]>([]);
    // Inline edit state for selected term label
    const [isEditingTermLabel, setIsEditingTermLabel] = useState(false);
    const [termLabelInput, setTermLabelInput] = useState("");
    const termLabelInputRef = useRef<HTMLInputElement | null>(null);
    // Sorting modals
    const [showTermSort, setShowTermSort] = useState(false);
    const [termSortList, setTermSortList] = useState<TermDoc[]>([]);
    const [showGroupSort, setShowGroupSort] = useState(false);
    const [groupSortList, setGroupSortList] = useState<Requirement[]>([]);

    useEffect(() => {
        const loadAll = async () => {
            try {
                setLoading(true);
                const [reqSnap, timesSnap, labelsSnap, termsSnap] = await Promise.all([
                    getDocs(collection(db, "requirements")),
                    getDocs(collection(db, "times")),
                    getDocs(collection(db, "termLabels")).catch(() => null),
                    getDocs(collection(db, "terms")).catch(() => null),
                ]);

                const reqs: Requirement[] = reqSnap.docs.map((d) => {
                    const data = d.data() as any;
                    return {
                        id: d.id,
                        term: data.term,
                        category: data.category,
                        requiredCount: data.requiredCount ?? 0,
                        order: typeof data?.order === "number" ? data.order : undefined,
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

                // Load terms from Firestore if present
                if (termsSnap) {
                    const list: TermDoc[] = termsSnap.docs
                        .map((d) => {
                            const data = d.data() as any;
                            const value = typeof data?.value === "number" ? data.value : undefined;
                            const label = typeof data?.label === "string" ? data.label : "";
                            const order = typeof data?.order === "number" ? data.order : undefined;
                            if (typeof value !== "number") return null;
                            return { docId: d.id, value, label, order } as TermDoc;
                        })
                        .filter(Boolean) as TermDoc[];
                    list.sort((a, b) => {
                        const oa = a.order ?? a.value;
                        const ob = b.order ?? b.value;
                        return oa - ob;
                    });
                    setTerms(list);
                }

                // Load optional term label overrides
                if (labelsSnap) {
                    const map: Record<number, string> = {};
                    labelsSnap.docs.forEach((d) => {
                        const data = d.data() as any;
                        const val = parseInt(d.id, 10);
                        if (!Number.isNaN(val) && typeof data?.label === "string" && data.label.trim()) {
                            map[val] = data.label.trim();
                        }
                    });
                    setTermLabelOverrides(map);
                }
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
        .sort((a, b) => {
            const ao = a.order ?? Number.MAX_SAFE_INTEGER;
            const bo = b.order ?? Number.MAX_SAFE_INTEGER;
            if (ao !== bo) return ao - bo;
            return a.category.localeCompare(b.category, "nb-NO", { sensitivity: "base" });
        });

    const termOptionsWithOverrides = useMemo(() => {
        // Derive strictly from Firestore terms; apply optional overrides from termLabels
        const base: { value: number; label: string }[] = terms
            .slice()
            .sort((a, b) => (a.order ?? a.value) - (b.order ?? b.value))
            .map((t) => ({ value: t.value, label: t.label || `Termin ${t.value}` }));
        if (Object.keys(termLabelOverrides).length > 0) {
            return base.map((opt) => ({
                ...opt,
                label: termLabelOverrides[opt.value] ?? opt.label,
            }));
        }
        return base;
    }, [terms, termLabelOverrides]);

    const labelForTerm = (value: number | null | undefined) => {
        return labelFromTerm(termOptionsWithOverrides, value ?? null);
    };

    // Start inline editing (replace select with input)
    const startInlineRename = () => {
        if (selectedTerm === "") return;
        const current = labelForTerm(selectedTerm as number);
        setTermLabelInput(current);
        setIsEditingTermLabel(true);
        setTimeout(() => termLabelInputRef.current?.focus(), 0);
    };

    // Cancel inline editing
    const cancelInlineRename = () => {
        setIsEditingTermLabel(false);
        setTermLabelInput("");
    };

    // Save inline edited label
    const saveInlineRename = async () => {
        if (selectedTerm === "") return;
        const current = labelForTerm(selectedTerm as number);
        const newLabel = termLabelInput.trim();
        if (!newLabel || newLabel === current) {
            // Nothing to save – just exit edit mode
            setIsEditingTermLabel(false);
            return;
        }
        try {
            // If term exists in Firestore 'terms', update that document; otherwise fall back to legacy termLabels override
            const existing = terms.find((t) => t.value === Number(selectedTerm));
            if (existing) {
                await updateDoc(doc(db, "terms", existing.docId), {
                    label: newLabel,
                    updatedAt: serverTimestamp(),
                } as any);
                setTerms((prev) =>
                    prev.map((t) => (t.docId === existing.docId ? { ...t, label: newLabel } : t))
                );
            } else {
                const id = String(selectedTerm);
                await setDoc(
                    doc(db, "termLabels", id),
                    {
                        label: newLabel,
                        updatedAt: serverTimestamp(),
                        value: Number(selectedTerm),
                    },
                    { merge: true }
                );
                setTermLabelOverrides((prev) => ({ ...prev, [Number(selectedTerm)]: newLabel }));
            }
            setIsEditingTermLabel(false);
        } catch (e) {
            console.error("Feil ved endring av modulnavn:", e);
            alert("Kunne ikke endre navn på modulen.");
        }
    };

    // Create a new term and immediately start inline rename
    const createNewTerm = async () => {
        try {
            const currentValues = terms.map((t) => t.value);
            const currentOrders = terms.map((t) => t.order ?? t.value);
            const maxVal = currentValues.length > 0 ? Math.max(...currentValues) : 0;
            const maxOrder = currentOrders.length > 0 ? Math.max(...currentOrders) : 0;
            const newValue = maxVal + 1;
            const newOrder = maxOrder + 1;
            const ref = await addDoc(collection(db, "terms"), {
                value: newValue,
                label: "",
                order: newOrder,
                createdAt: serverTimestamp(),
            });
            const newTerm: TermDoc = { docId: ref.id, value: newValue, label: "", order: newOrder };
            setTerms((prev) => [...prev, newTerm]);
            setSelectedTerm(newValue);
            setTermLabelInput("");
            setIsEditingTermLabel(true);
            setTimeout(() => termLabelInputRef.current?.focus(), 0);
        } catch (e) {
            console.error("Kunne ikke opprette ny oppmøtebok:", e);
            alert("Kunne ikke opprette ny oppmøtebok.");
        }
    };

    // ----- Sorting helpers -----
    const openTermSort = () => {
        // Only open if we have terms in Firestore
        if (terms.length === 0) return;
        const list = terms
            .slice()
            .sort((a, b) => (a.order ?? a.value) - (b.order ?? b.value));
        setTermSortList(list);
        setShowTermSort(true);
    };

    const moveTerm = (index: number, dir: -1 | 1) => {
        setTermSortList((prev) => {
            const arr = prev.slice();
            const to = index + dir;
            if (to < 0 || to >= arr.length) return prev;
            const [m] = arr.splice(index, 1);
            arr.splice(to, 0, m);
            return arr;
        });
    };

    const saveTermOrder = async () => {
        try {
            const batch = writeBatch(db);
            termSortList.forEach((t, idx) => {
                batch.update(doc(db, "terms", t.docId), { order: idx + 1 } as any);
            });
            await batch.commit();
            // Reflect locally
            setTerms(termSortList.map((t, idx) => ({ ...t, order: idx + 1 })));
            setShowTermSort(false);
        } catch (e) {
            console.error("Kunne ikke lagre sortering av terminer:", e);
            alert("Kunne ikke lagre sortering av terminer.");
        }
    };

    const openGroupSort = () => {
        if (selectedTerm === "") return;
        const list = requirements
            .filter((r) => r.term === selectedTerm)
            .slice()
            .sort((a, b) => {
                const ao = a.order ?? Number.MAX_SAFE_INTEGER;
                const bo = b.order ?? Number.MAX_SAFE_INTEGER;
                if (ao !== bo) return ao - bo;
                return a.category.localeCompare(b.category, "nb-NO", { sensitivity: "base" });
            });
        setGroupSortList(list);
        setShowGroupSort(true);
    };

    const moveGroup = (index: number, dir: -1 | 1) => {
        setGroupSortList((prev) => {
            const arr = prev.slice();
            const to = index + dir;
            if (to < 0 || to >= arr.length) return prev;
            const [m] = arr.splice(index, 1);
            arr.splice(to, 0, m);
            return arr;
        });
    };

    const saveGroupOrder = async () => {
        try {
            const batch = writeBatch(db);
            groupSortList.forEach((r, idx) => {
                batch.update(doc(db, "requirements", r.id), { order: idx + 1 } as any);
            });
            await batch.commit();
            // Reflect locally for selected term only
            setRequirements((prev) => {
                const map: Record<string, number> = {};
                groupSortList.forEach((r, idx) => (map[r.id] = idx + 1));
                return prev.map((r) =>
                    map[r.id] ? { ...r, order: map[r.id] } : r
                );
            });
            setShowGroupSort(false);
        } catch (e) {
            console.error("Kunne ikke lagre sortering av grupper:", e);
            alert("Kunne ikke lagre sortering av grupper.");
        }
    };

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
            // Sett order til siste plass for valgt termin
            const currentForTerm = requirements.filter((r) => r.term === selectedTerm);
            const maxOrder = currentForTerm.length
                ? Math.max(
                      ...currentForTerm.map((r) =>
                          typeof r.order === "number" ? r.order : 0
                      )
                  )
                : 0;
            const newOrder = maxOrder + 1;
            const ref = await addDoc(collection(db, "requirements"), {
                term: selectedTerm,
                category: name,
                requiredCount: 0,
                order: newOrder,
            });
            setRequirements((prev) => [
                ...prev,
                {
                    id: ref.id,
                    term: selectedTerm,
                    category: name,
                    requiredCount: 0,
                    order: newOrder,
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
            `Slette timen "${time.name}" fra ${labelForTerm(time.term)}? Historiske sesjoner beholdes, men timen forsvinner fra admin-oppsettet.`
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
        return <LoadingSpinner />;
    }

    return (
        <>
        <section style={{ marginBottom: "2rem" }}>
            {/* Toppkontroller: Termin (øverst), deretter Ny gruppe + Legg til gruppe under (desktop og mobil) */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    marginBottom: "0.75rem",
                }}
            >
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {isEditingTermLabel ? (
                        <input
                            ref={termLabelInputRef}
                            type="text"
                            value={termLabelInput}
                            onChange={(e) => setTermLabelInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    void saveInlineRename();
                                } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelInlineRename();
                                }
                            }}
                            placeholder="Navn på modul"
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: "0.35rem 0.5rem",
                                borderRadius: "0.5rem",
                                border: "1px solid #d1d5db",
                            }}
                        />
                    ) : (
                        <select
                            value={selectedTerm}
                            onChange={(e) => {
                                const v = e.target.value;
                                if (v === "__new__") {
                                    void createNewTerm();
                                    return;
                                }
                                setSelectedTerm(v === "" ? "" : parseInt(v, 10));
                            }}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: "0.35rem 0.5rem",
                                borderRadius: "0.5rem",
                                border: "1px solid #d1d5db",
                            }}
                        >
                            <option value="" disabled>
                                Velg termin
                            </option>
                            {termOptionsWithOverrides.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                            <option value="__new__">+ Ny oppmøtebok</option>
                        </select>
                    )}
                    <button
                        type="button"
                        disabled={selectedTerm === "" && !isEditingTermLabel}
                        onClick={() => {
                            if (isEditingTermLabel) {
                                void saveInlineRename();
                            } else {
                                startInlineRename();
                            }
                        }}
                        style={{
                            width: "160px",
                            padding: "0.45rem 0.9rem",
                            borderRadius: "999px",
                            border: "none",
                            backgroundColor: "#6CE1AB",
                            color: "black",
                            fontSize: "0.9rem",
                            cursor:
                                selectedTerm === "" && !isEditingTermLabel
                                    ? "not-allowed"
                                    : "pointer",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {isEditingTermLabel ? "Lagre" : "Endre navn"}
                    </button>
                    {/* Sort terms button */}
                    <button
                        type="button"
                        title="Sorter oppmøtebøker"
                        disabled={terms.length === 0}
                        onClick={openTermSort}
                        style={{
                            padding: "0.35rem 0.5rem",
                            borderRadius: "0.5rem",
                            border: "1px solid #d1d5db",
                            background: "#ffffff",
                            fontSize: "0.9rem",
                            cursor: terms.length === 0 ? "not-allowed" : "pointer",
                        }}
                    >
                        ⇅
                    </button>
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                        alignItems: "center",
                    }}
                >
                    <input
                        type="text"
                        placeholder="Ny gruppe..."
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                void handleAddCategory();
                            }
                        }}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            padding: "0.35rem 0.5rem",
                            borderRadius: "0.5rem",
                            border: "1px solid #d1d5db",
                        }}
                    />
                    <button
                        type="button"
                        onClick={handleAddCategory}
                        style={{
                            width: "160px",
                            padding: "0.45rem 0.9rem",
                            borderRadius: "999px",
                            border: "none",
                            backgroundColor: "#6CE1AB",
                            color: "black",
                            fontSize: "0.9rem",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                        }}
                    >
                        Legg til gruppe
                    </button>
                    {/* Sort groups button */}
                    <button
                        type="button"
                        title="Sorter grupper"
                        disabled={selectedTerm === "" || requirementsForTerm.length === 0}
                        onClick={openGroupSort}
                        style={{
                            padding: "0.35rem 0.5rem",
                            borderRadius: "0.5rem",
                            border: "1px solid #d1d5db",
                            background: "#ffffff",
                            fontSize: "0.9rem",
                            cursor:
                                selectedTerm === "" || requirementsForTerm.length === 0
                                    ? "not-allowed"
                                    : "pointer",
                        }}
                    >
                        ⇅
                    </button>
                </div>
            </div>

            {requirementsForTerm.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                    Ingen grupper definert ennå for {labelForTerm(selectedTerm as number)}.
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
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                void handleAddTime(req);
                                            }
                                        }}
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
        {/* Modals for sorting */}
        {showTermSort && (
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
                    <h3 style={{ marginTop: 0 }}>Sorter oppmøtebøker</h3>
                    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem" }}>
                        {termSortList.map((t, idx) => (
                            <li
                                key={t.docId}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    border: "1px solid #e5e7eb",
                                    borderRadius: "0.5rem",
                                    padding: "0.4rem 0.6rem",
                                    marginBottom: "0.4rem",
                                }}
                            >
                                <span style={{ fontSize: "0.9rem" }}>{t.label || `Termin ${t.value}`}</span>
                                <span style={{ display: "flex", gap: "0.25rem" }}>
                                    <button
                                        type="button"
                                        onClick={() => moveTerm(idx, -1)}
                                        disabled={idx === 0}
                                        style={{ padding: "0.2rem 0.4rem", borderRadius: "0.35rem", border: "1px solid #d1d5db", background: "#fff" }}
                                    >
                                        ▲
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => moveTerm(idx, 1)}
                                        disabled={idx === termSortList.length - 1}
                                        style={{ padding: "0.2rem 0.4rem", borderRadius: "0.35rem", border: "1px solid #d1d5db", background: "#fff" }}
                                    >
                                        ▼
                                    </button>
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                        <button
                            type="button"
                            onClick={() => setShowTermSort(false)}
                            style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: "1px solid #d1d5db", background: "#fff" }}
                        >
                            Avbryt
                        </button>
                        <button
                            type="button"
                            onClick={() => void saveTermOrder()}
                            style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: "none", background: "#16a34a", color: "#fff" }}
                        >
                            Lagre rekkefølge
                        </button>
                    </div>
                </div>
            </div>
        )}

        {showGroupSort && (
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
                    <h3 style={{ marginTop: 0 }}>Sorter grupper</h3>
                    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem" }}>
                        {groupSortList.map((g, idx) => (
                            <li
                                key={g.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    border: "1px solid #e5e7eb",
                                    borderRadius: "0.5rem",
                                    padding: "0.4rem 0.6rem",
                                    marginBottom: "0.4rem",
                                }}
                            >
                                <span style={{ fontSize: "0.9rem" }}>{g.category}</span>
                                <span style={{ display: "flex", gap: "0.25rem" }}>
                                    <button
                                        type="button"
                                        onClick={() => moveGroup(idx, -1)}
                                        disabled={idx === 0}
                                        style={{ padding: "0.2rem 0.4rem", borderRadius: "0.35rem", border: "1px solid #d1d5db", background: "#fff" }}
                                    >
                                        ▲
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => moveGroup(idx, 1)}
                                        disabled={idx === groupSortList.length - 1}
                                        style={{ padding: "0.2rem 0.4rem", borderRadius: "0.35rem", border: "1px solid #d1d5db", background: "#fff" }}
                                    >
                                        ▼
                                    </button>
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                        <button
                            type="button"
                            onClick={() => setShowGroupSort(false)}
                            style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: "1px solid #d1d5db", background: "#fff" }}
                        >
                            Avbryt
                        </button>
                        <button
                            type="button"
                            onClick={() => void saveGroupOrder()}
                            style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: "none", background: "#16a34a", color: "#fff" }}
                        >
                            Lagre rekkefølge
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};


// ---------- Hoved AdminPage med gamle knappe-struktur ----------

const AdminPage: React.FC = () => {
    const { user, loading, logout } = useAuth();
    const [mainTab, setMainTab] = useState<"setup" | "users" | "teacherView">(
        "setup"
    );
    const [showProfile, setShowProfile] = useState(false);

    if (loading) {
        return (
            <div
                style={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <LoadingSpinner />
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
        <>
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                padding: "1.5rem 1rem",
            }}
        >
            <div className="page-card page-card--admin">
                {/* Topp: navn + logg ut */}
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "0.75rem",
                    }}
                >
                    <div style={{ fontWeight: 600 }}>
                        {user.displayName || user.email}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                            type="button"
                            onClick={() => setShowProfile(true)}
                            style={{
                                padding: "0.35rem 0.9rem",
                                borderRadius: "999px",
                                border: "1px solid #d1d5db",
                                background: "#ffffff",
                                cursor: "pointer",
                                fontSize: "0.85rem",
                            }}
                        >
                            Min profil
                        </button>
                        <button
                            type="button"
                            onClick={logout}
                            style={{
                                padding: "0.35rem 0.9rem",
                                borderRadius: "999px",
                                border: "1px solid #d1d5db",
                                background: "#ffffff",
                                cursor: "pointer",
                                fontSize: "0.85rem",
                            }}
                        >
                            Logg ut
                        </button>
                    </div>
                </div>
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

                    {/* Øverste knapper: Oppmøtebøker / Brukere */}
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
                                    mainTab === "setup" ? "#6CE1AB" : "#ffffff",
                                color: mainTab === "setup" ? "black" : "#111827",
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
                                    mainTab === "users" ? "#6CE1AB" : "#ffffff",
                                color: mainTab === "users" ? "black" : "#111827",
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
            </div>
        </div>
        {showProfile && (
            <ProfileModal
                uid={user.uid}
                role={user.role}
                email={user.email}
                displayName={user.displayName}
                onClose={() => setShowProfile(false)}
            />
        )}
        </>
    );
};

export default AdminPage;