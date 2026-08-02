import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Input } from '@/components/ui/input';

interface MoneyInputProps {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
}

const nf = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatMoneyRaw(raw: string): string {
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  let integerRaw: string;
  let decimalRaw: string;
  let trailingSep = false;
  if (lastSep >= 0) {
    integerRaw = raw.slice(0, lastSep);
    decimalRaw = raw.slice(lastSep + 1);
    trailingSep = decimalRaw === '';
  } else {
    integerRaw = raw;
    decimalRaw = '';
  }
  let intDigits = integerRaw.replace(/[^0-9]/g, '');
  let decDigits = decimalRaw.replace(/[^0-9]/g, '').slice(0, 2);
  if (lastSep < 0 && intDigits.length > 2) {
    decDigits = intDigits.slice(-2);
    intDigits = intDigits.slice(0, -2);
  }
  if (intDigits === '' && (decDigits !== '' || trailingSep)) intDigits = '0';
  const grouped = groupThousands(intDigits);
  if (trailingSep) return grouped + ',';
  if (decDigits) return grouped + ',' + decDigits;
  return grouped;
}

export default function MoneyInput({ value, onChange, className, placeholder, autoFocus, disabled, id }: MoneyInputProps) {
  const [raw, setRaw] = useState<string>(() => nf.format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(nf.format(value));
  }, [value, focused]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const formatted = formatMoneyRaw(e.target.value);
    setRaw(formatted);
    const n = parseFloat(formatted.replace(/\./g, '').replace(',', '.'));
    onChange(Number.isNaN(n) ? 0 : n);
  };

  const handleFocus = () => {
    setFocused(true);
    if (value === 0) setRaw('');
  };

  const handleBlur = () => {
    setFocused(false);
    setRaw(nf.format(value));
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      value={raw}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
}
