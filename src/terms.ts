import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export type TermOption = {
  value: number;
  label: string;
  order?: number;
};

/** Load and sort term options from Firestore collection `terms`. */
export async function fetchTermOptions(): Promise<TermOption[]> {
  const snap = await getDocs(collection(db, "terms"));
  const list: TermOption[] = snap.docs
    .map((d) => {
      const data = d.data() as any;
      const value = typeof data?.value === "number" ? data.value : undefined;
      if (typeof value !== "number") return null;
      const label = typeof data?.label === "string" ? data.label : "";
      const order = typeof data?.order === "number" ? data.order : undefined;
      return { value, label, order } as TermOption;
    })
    .filter(Boolean) as TermOption[];
  list.sort((a, b) => (a.order ?? a.value) - (b.order ?? b.value));
  return list;
}

/** React hook: loads term options from Firestore once. */
export function useTermOptions() {
  const [options, setOptions] = useState<TermOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const list = await fetchTermOptions();
        if (mounted) setOptions(list);
      } catch (e) {
        if (mounted) setError(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const byValue = useMemo(() => {
    const m = new Map<number, TermOption>();
    for (const o of options) m.set(o.value, o);
    return m;
  }, [options]);

  return { options, byValue, loading, error } as const;
}

/** Returns a friendly full label for a term, using options if present, else `Termin {value}`. */
export function labelFromTerm(
  options: TermOption[] | Map<number, TermOption>,
  value: number | null | undefined
): string {
  if (value == null) return "Ukjent termin";
  if (value === 99) return "Permisjon";
  let found: TermOption | undefined;
  if (Array.isArray(options)) {
    found = options.find((o) => o.value === value);
  } else if (options instanceof Map) {
    found = options.get(value);
  }
  return found && found.label ? found.label : `Termin ${value}`;
}

// Short label utils, ported from legacy but without static config dependency
export function shortLabelFromFullLabel(label: string): string {
  if (label === "Testmodul 1 - Testtermin 1") {
    return label;
  }
  const blockMatch = /(Modul)\s+(\d+)\s*-\s*(Blokk|Termin)\s+(\d+)/i;
  const m1 = label.match(blockMatch);
  if (m1) {
    const moduleNum = m1[2];
    const blockNum = m1[4];
    return `M${moduleNum} - T${blockNum}`;
  }
  const simpleMatch = /(Modul|Termin)\s+(\d+)/i;
  const m2 = label.match(simpleMatch);
  if (m2) {
    const moduleNum = m2[2];
    return `M${moduleNum}`;
  }
  return label;
}

export function shortLabelFromTerm(
  options: TermOption[] | Map<number, TermOption>,
  value?: number | null
): string {
  if (value == null) return "";
  const full = labelFromTerm(options, value);
  return shortLabelFromFullLabel(full);
}
