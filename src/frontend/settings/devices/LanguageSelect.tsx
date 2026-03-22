import React, { useState, useEffect, useRef } from 'react';
import styles from '../settings.module.css';

const LANGUAGES = [
    { value: 'en-us', label: 'English (US)' },
    { value: 'es-us', label: 'Spanish (US)' },
    { value: 'en-au', label: 'English (AU)' },
    { value: 'fr-fr', label: 'French' },
    { value: 'de-de', label: 'German' },
    { value: 'ja-jp', label: 'Japanese' },
    { value: 'zh',    label: 'Chinese (Mandarin)' },
    { value: 'pt-br', label: 'Portuguese (BR)' },
];

interface Props {
    value: string[];
    onChange: (value: string[]) => void;
}

export function LanguageSelect({ value, onChange }: Props) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onOutside);
        return () => document.removeEventListener('mousedown', onOutside);
    }, [open]);

    const label = value.length === 0
        ? 'None selected'
        : value.length === 1
            ? (LANGUAGES.find(l => l.value === value[0])?.label ?? value[0])
            : `${value.length} languages`;

    function toggle(langValue: string, checked: boolean) {
        if (checked) onChange([...value, langValue]);
        else onChange(value.filter(v => v !== langValue));
    }

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                type="button"
                className={styles.langButton}
                onClick={() => setOpen(o => !o)}
            >
                <span>{label}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
            </button>
            {open && (
                <div className={styles.langDropdown}>
                    {LANGUAGES.map(lang => (
                        <label key={lang.value} className={styles.langOption}>
                            <input
                                type="checkbox"
                                checked={value.includes(lang.value)}
                                onChange={e => toggle(lang.value, e.target.checked)}
                            />
                            {lang.label}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}
