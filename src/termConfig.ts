export type TermOption = {
    value: number;
    label: string;
};

export const TERM_OPTIONS: TermOption[] = [
    // 1.året. Term 1+2
    { value: 1, label: "Modul 1 - Blokk 1" },
    { value: 2, label: "Modul 1 - Blokk 2" },
    { value: 3, label: "Modul 1 - Blokk 3" },
    { value: 4, label: "Modul 2 - Termin 1" },
    { value: 5, label: "Modul 2 - Termin 2" },
    { value: 6, label: "Modul 2 - Propen" },
    { value: 7, label: "Modul 3 - Termin 1" },
    { value: 8, label: "Modul 3 - Termin 2" },
    { value: 9, label: "Modul 4" },
    { value: 10, label: "Modul 5" },
    { value: 11, label: "Modul 6" },
    { value: 12, label: "Modul 7" },
    { value: 13, label: "Modul 8 - Termin 1" },
    { value: 14, label: "Modul 8 - Termin 2" },

    //Test
    { value: 999, label: "Test" },
];

export function termLabel(value: number | null | undefined): string {
    if (!value) return "Ukjent termin";
    const found = TERM_OPTIONS.find((t) => t.value === value);
    return found ? found.label : `Termin ${value}`;
}
// Brukes til å forkorte tekst som "Termin 1 - Blokk 2" -> "M1B2"
export function shortLabelFromFullLabel(label: string): string {
    if (label == "Testmodul 1 - Testtermin 1") {
        return label;
    }
    // Matcher "Modul 1 - Blokk 2" eller "Termin 1 - Blokk 2"
    const blockMatch = /(Modul)\s+(\d+)\s*-\s*(Blokk|Termin)\s+(\d+)/i;
    const m1 = label.match(blockMatch);
    if (m1) {
        const moduleNum = m1[2];
        const blockNum = m1[4];
        return `M${moduleNum} - T${blockNum}`;
    }

    // Matcher "Modul 4" eller "Termin 4"
    const simpleMatch = /(Modul|Termin)\s+(\d+)/i;
    const m2 = label.match(simpleMatch);
    if (m2) {
        const moduleNum = m2[2];
        return `M${moduleNum}`;
    }

    // Fallback – ukjent format, vis full label
    return label;
}

// Global helper: ta term-verdi -> kortlabel (M1B1, M4, osv.)
export function termShortLabel(term?: number | null): string {
    const full = termLabel(term);
    if (!full) return "";
    return shortLabelFromFullLabel(full);
}