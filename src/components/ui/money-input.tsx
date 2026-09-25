import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Input } from '@/components/ui/input';
// F73 — la máscara vive en una regla PURA (`src/lib/money.ts`) con sus pruebas (`tools/money_test.ts`):
// acá sólo se enchufa. La regla vieja tomaba los dígitos sin separador como CENTAVOS («145» → «1,45»)
// y por eso cargar $145 exigía teclear 14500.
import { formatMoneyInput, formatMoneyDisplay, parseMoneyInput } from '@/lib/money';

interface MoneyInputProps {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
}

export default function MoneyInput({ value, onChange, className, placeholder, autoFocus, disabled, id }: MoneyInputProps) {
  // Mientras el campo está enfocado se muestra lo que el operario escribe; al salir, el número
  // guardado con sus dos decimales («145,00»).
  const [raw, setRaw] = useState<string>(() => formatMoneyDisplay(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(formatMoneyDisplay(value));
  }, [value, focused]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const formatted = formatMoneyInput(e.target.value);
    setRaw(formatted);
    onChange(parseMoneyInput(formatted));
  };

  const handleFocus = () => {
    setFocused(true);
    if (value === 0) setRaw('');
  };

  const handleBlur = () => {
    setFocused(false);
    setRaw(formatMoneyDisplay(value));
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
