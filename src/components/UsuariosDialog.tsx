import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Trash2, KeyRound, Check, Users } from 'lucide-react';
import { api } from '../db';
import { cn } from '@/lib/utils';
import type { AppUser } from '../types';

/**
 * F68 — PERSONAS Y ACCESOS (sólo el Master).
 *
 * Pedido del dueño: «sería bueno la sesión de caja 1 pueda usar todo, ver su día de caja, pero no
 * pueda ver cuánto factura la master; no tenga tanto acceso». Acá se crean las personas: el Master
 * (dueño, ve todo) y las Cajas (operarios del mostrador, cada una con SU PIN).
 *
 * Reglas que impone el BACKEND (no la UI): no se puede borrar ni apagar al último Master, el rol
 * sólo puede ser `master` o `caja`, y cada persona entra con su PIN (vacío = entra sin PIN).
 * Todo lo que se crea acá queda anotado como AUTOR en el libro de plata.
 */
const COLORES = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export default function UsuariosDialog({ open, onClose, onChanged }: {
  open: boolean;
  onClose: () => void;
  /** Avisa al padre que cambió la lista (para que la pantalla de acceso la relea). */
  onChanged?: () => void;
}) {
  const [people, setPeople] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verPin, setVerPin] = useState<number | null>(null);
  const [pinNuevo, setPinNuevo] = useState('');
  // Alta de persona nueva
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<'caja' | 'master'>('caja');
  const [color, setColor] = useState(COLORES[0]);
  const [pin, setPin] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      setPeople(await api.getUsers(false));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) { void cargar(); setNuevo(false); setVerPin(null); setError(null); } }, [open]);

  const crear = async () => {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await api.addUser(nombre.trim(), rol, pin, color);
      toast.success(`Persona creada: ${nombre.trim()}${pin ? '' : ' (entra sin PIN)'}`);
      setNombre(''); setPin(''); setRol('caja'); setNuevo(false);
      await cargar();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const guardarPin = async (id: number) => {
    setError(null);
    try {
      await api.setUserPin(id, pinNuevo);
      toast.success(pinNuevo ? 'PIN actualizado' : 'Esa persona entra sin PIN');
      setVerPin(null); setPinNuevo('');
      await cargar();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const alternarActivo = async (u: AppUser) => {
    setError(null);
    try {
      await api.updateUser(u.id, u.name, u.color, !u.active);
      await cargar();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const borrar = async (u: AppUser) => {
    setError(null);
    try {
      await api.deleteUser(u.id);
      toast.success(`Se borró a ${u.name} (sus movimientos quedan con su nombre)`);
      await cargar();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" /> Personas y accesos
          </DialogTitle>
          <DialogDescription>
            Cada persona entra con <strong>su propio PIN</strong>. El <strong>Master</strong> (dueño) ve todo;
            las <strong>Cajas</strong> usan todo el mostrador y ven <strong>su</strong> día, pero no la facturación del dueño.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3" data-panel="usuarios">
          {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}

          {people.map(u => (
            <div key={u.id} data-user-row={u.id}
              className={cn('rounded-lg border border-border p-3 flex flex-col gap-2', !u.active && 'opacity-60')}>
              <div className="flex items-center gap-3">
                <span className="size-9 shrink-0 rounded-full text-white text-xs font-bold flex items-center justify-center"
                  style={{ backgroundColor: u.color || '#0ea5e9' }}>
                  {u.name.trim().slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {u.name}
                    {u.role === 'master'
                      ? <Badge className="ml-2 text-[10px]" data-user-role="master">Master · ve todo</Badge>
                      : <Badge variant="secondary" className="ml-2 text-[10px]" data-user-role="caja">Caja</Badge>}
                    {!u.active && <Badge variant="outline" className="ml-2 text-[10px]">apagada</Badge>}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {u.has_pin ? 'Entra con PIN' : 'Entra sin PIN (poné uno para protegerla)'}
                  </p>
                </div>
                <Button variant="outline" size="sm" data-user-pin={u.id}
                  onClick={() => { setVerPin(verPin === u.id ? null : u.id); setPinNuevo(''); setError(null); }}>
                  <KeyRound className="size-3.5" /> PIN
                </Button>
                <Button variant="outline" size="sm" data-user-toggle={u.id} onClick={() => void alternarActivo(u)}>
                  {u.active ? 'Apagar' : 'Activar'}
                </Button>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-danger"
                  data-user-delete={u.id} title="Borrar (no se puede borrar al último Master)"
                  onClick={() => void borrar(u)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {verPin === u.id && (
                <div className="flex items-end gap-2 border-t border-border/60 pt-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">PIN de 4 dígitos (vacío = sin PIN)</label>
                    <Input value={pinNuevo} inputMode="numeric" maxLength={4} className="w-32"
                      data-user-pin-input={u.id}
                      onChange={e => setPinNuevo(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                  </div>
                  <Button size="sm" data-user-pin-save={u.id} onClick={() => void guardarPin(u.id)}>
                    <Check className="size-3.5" /> Guardar
                  </Button>
                </div>
              )}
            </div>
          ))}

          {!nuevo ? (
            <Button variant="outline" className="self-start" data-action="nueva-persona" onClick={() => setNuevo(true)}>
              <UserPlus className="size-4" /> Agregar persona
            </Button>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-3 flex flex-col gap-3" data-panel="nueva-persona">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Nombre</label>
                  <Input autoFocus value={nombre} data-new-user-name placeholder="Ej: Caja 1"
                    onChange={e => setNombre(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">PIN (4 dígitos)</label>
                  <Input value={pin} inputMode="numeric" maxLength={4} data-new-user-pin placeholder="Ej: 2468"
                    onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Rol:</span>
                <Button type="button" size="sm" variant={rol === 'caja' ? 'default' : 'outline'}
                  data-new-user-role="caja" onClick={() => setRol('caja')}>Caja (mostrador)</Button>
                <Button type="button" size="sm" variant={rol === 'master' ? 'default' : 'outline'}
                  data-new-user-role="master" onClick={() => setRol('master')}>Master (dueño)</Button>
                <span className="ml-2 text-sm font-medium">Color:</span>
                {COLORES.map(c => (
                  <button key={c} type="button" aria-label={`color ${c}`} onClick={() => setColor(c)}
                    className={cn('size-6 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" data-new-user-save disabled={guardando || !nombre.trim()} onClick={() => void crear()}>
                  {guardando ? 'Creando…' : 'Crear'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setNuevo(false); setNombre(''); setPin(''); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger" data-user-error>{error}</p>}
        </div>

        <DialogFooter>
          <p className="mr-auto text-[11px] text-muted-foreground">
            El nombre de cada persona queda anotado en cada venta, abono y gasto que registre.
          </p>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
