import { Suspense, lazy, useEffect, useState } from 'react';
// F76 — la app se actualiza sola: el bus avisa a las pantallas y acá se ve que está sincronizada.
import { bumpDataVersion } from './lib/sync';
import { useSyncLabel } from './lib/use-data-version';
import {
  LayoutDashboard, ShoppingCart, Wrench, Package, Users, BookOpen,
  PanelLeftClose, PanelLeftOpen, LifeBuoy, ShoppingBag, Lock,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Toaster } from './components/ui/sonner';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import UpdateDialog from './components/UpdateDialog';
import { api } from './db';
import { checkForUpdate, downloadedVersion } from './lib/update';
import { cn } from './lib/utils';
import { toast } from 'sonner';
import './index.css';

// Lazy: cada pantalla es un chunk separado → arranque más rápido en PCs de bajos recursos
const Dashboard = lazy(() => import('./components/Dashboard'));
const Sales = lazy(() => import('./components/Sales'));
const Services = lazy(() => import('./components/Services'));
const Inventory = lazy(() => import('./components/Inventory'));
const Clients = lazy(() => import('./components/Clients'));
const DailyLedger = lazy(() => import('./components/DailyLedger'));
const Help = lazy(() => import('./components/Help'));
const Pedidos = lazy(() => import('./components/Pedidos'));

type Tab = 'dashboard' | 'ventas' | 'servicios' | 'inventario' | 'clientes' | 'libro' | 'pedidos' | 'ayuda';

const navItems: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'ventas', label: 'Ventas', icon: ShoppingCart },
  { key: 'servicios', label: 'Servicio Técnico', icon: Wrench },
  { key: 'inventario', label: 'Inventario', icon: Package },
  { key: 'pedidos', label: 'Pedidos', icon: ShoppingBag },
  { key: 'clientes', label: 'Clientes', icon: Users },
  { key: 'libro', label: 'Libro Diario', icon: BookOpen },
  { key: 'ayuda', label: 'Ayuda', icon: LifeBuoy },
];

type Role = 'owner' | 'cashier' | 'loading';

/** F68 — una persona de la app (Master / Caja). El PIN no viaja nunca al frontend. */
interface AppUser { id: number; name: string; role: 'master' | 'caja'; color: string; active: boolean; has_pin: boolean }

function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1');
  const [role, setRole] = useState<Role>('loading');
  // F76 — el rótulo del indicador de sincronización (sube con cada escritura y se refresca solo).
  const sync = useSyncLabel();
  const syncOk = role === 'owner' || role === 'cashier';
  /** F68 — QUIÉN está usando la app (Master / Caja). `null` = sesión cerrada. */
  const [who, setWho] = useState<AppUser | null>(null);
  /** F68 — las personas para elegir en el acceso (vacío = instalación de un solo usuario). */
  const [people, setPeople] = useState<AppUser[]>([]);
  /** F68 — la persona elegida en la pantalla de acceso (todavía sin entrar). */
  const [picked, setPicked] = useState<AppUser | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  // Actualización pendiente de instalar (dialog) — visible para owner Y cajera
  const [pendingUpdate, setPendingUpdate] = useState<import('@tauri-apps/plugin-updater').Update | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);

  useEffect(() => {
    // Fail-closed: si el IPC falla al arrancar (race en frío), se pide el PIN igual.
    // Verificado 2026-08-04: al primer arranque el invoke podía fallar y el catch
    // anterior abría la app sin PIN (bypass para cajeras) — cambio a pedir PIN.
    //
    // F68: el acceso es POR PERSONA. Si la instalación todavía no tiene usuarios (o no tiene PIN),
    // es de un solo dueño y entra directo (comportamiento de siempre).
    //
    // F68 (hallazgo de la prueba en vivo): la sesión vive en el BACKEND 12 h, así que al recargar la
    // página (F5, o el WebView que se reinicia) hay que RETOMARLA — si no, la UI mostraba la pantalla
    // de acceso mientras el backend seguía con la sesión abierta (dos verdades). Se pregunta quién
    // está antes de decidir: sesión abierta → se sigue con esa persona.
    Promise.all([
      api.getPinStatus().catch(() => true),
      // F69 (revisión adversarial): si NO se pudo leer el padrón, se reintenta UNA vez. Antes un
      // fallo de `getUsers` devolvía una lista vacía y, si además no había PIN en `settings`, la app
      // entraba directo como DUEÑO — o sea que un error de lectura abría la pantalla del dueño (lo
      // que pidió el dueño es que la caja NO la vea). El gate de escritura del backend sigue siendo
      // la seguridad real, pero la UI no puede regalarse.
      api.getUsers(true).catch(() => api.getUsers(true).catch(() => 'error' as const)),
      api.getCurrentUser().catch(() => null),
    ]).then(([hasPin, listaOCatch, actual]) => {
      const falloLista = listaOCatch === 'error';
      const lista: AppUser[] = falloLista ? [] : (listaOCatch as AppUser[]);
      setPeople(lista);
      const persona = actual ? lista.find(u => u.id === actual.id) ?? null : null;
      if (persona) {
        // sesión vigente: se retoma con esa persona (mismo rol y mismos permisos)
        setWho(persona);
        setRole(persona.role === 'caja' ? 'cashier' : 'owner');
        return;
      }
      // No se pudo leer quién hay: se pide el PIN de la instalación (pantalla vieja) en vez de
      // asumir que el que está enfrente es el dueño.
      if (falloLista) {
        setPinError('No se pudo leer la lista de personas: entrá con el PIN de la instalación.');
        setRole('loading');
        return;
      }
      if (!hasPin && lista.length === 0) { setRole('owner'); return; }
      if (lista.length === 0) { setRole('loading'); return; }   // instalación vieja con PIN suelto
      // F68: con UNA sola persona no hay nada que elegir (el caso de siempre: el dueño solo) → se pide
      // SU PIN directo, como antes de esta feature. El selector de personas aparece recién cuando hay
      // más de una (el día que el local crea «Caja 1»).
      if (lista.length === 1) {
        const unico = lista[0];
        if (!unico.has_pin) { setWho(unico); setRole(unico.role === 'caja' ? 'cashier' : 'owner'); return; }
        setPicked(unico);
        setRole('loading');
        return;
      }
      setRole('loading');   // 2+ personas: se elige quién entra
    });
  }, []);

  useEffect(() => {
    if (role === 'cashier' && tab === 'dashboard') setTab('ventas');
  }, [role, tab]);

  // F76 — VOLVER A LA APP LA PONE AL DÍA: si algo cambió desde afuera (otra sesión, un respaldo
  // restaurado, la base tocada a mano), al recuperar el foco la pantalla abierta se recarga sola.
  useEffect(() => {
    const alVolver = () => bumpDataVersion('volviste a la app', { inmediato: true });
    const alVisible = () => { if (!document.hidden) alVolver(); };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVisible);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVisible);
    };
  }, []);
  /**
   * F69 (revisión adversarial) — LA SESIÓN DE 12 h NO LA VIGILABA NADIE. La sesión vive en el backend
   * y vence sola: pasadas las 12 h, los movimientos de dinero se anotaban SIN AUTOR (el objetivo de
   * F68 se perdía en silencio) y la persona seguía viendo la pantalla como si nada. Se re-consulta
   * quién está al volver a la ventana y cada minuto: si la sesión se cerró, se vuelve a la pantalla de
   * acceso (con las personas releídas) y se pide el PIN otra vez.
   */
  useEffect(() => {
    if (role === 'loading') return;
    let cancelled = false;
    const revisar = async () => {
      try {
        const actual = await api.getCurrentUser();
        if (cancelled || actual) return;
        const lista = await api.getUsers(true).catch(() => null);
        if (cancelled) return;
        if (lista) setPeople(lista);
        setWho(null);
        setPicked(null);
        setPinInput('');
        setPinError('La sesión venció (dura 12 h): volvé a entrar con tu PIN.');
        setRole('loading');
      } catch { /* un fallo de lectura no debe sacar a nadie de su trabajo */ }
    };
    const timer = window.setInterval(revisar, 60_000);
    const onFocus = () => { void revisar(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [role]);

  // Versión real del paquete (reemplaza el texto hardcodeado "v0.2")
  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(m => m.getVersion().then(v => setAppVersion(`v${v}`)).catch(() => {}))
      .catch(() => {});
  }, []);

  // 1) Chequeo de salud post-actualización: solo cuando hay un estado "pending"
  // (primer arranque tras una actualización). Si algo crítico falla → rollback
  // automático a la versión anterior + relanzar. Si pasa → marca ok.
  // Nota: los warnings (ej. BCV sin internet) NO disparan rollback — una PC
  // offline no es una app rota (bug 2026-08-13: actualizaciones tumbadas por el scrape).
  useEffect(() => {
    if (role === 'loading') return;
    let cancelled = false;
    (async () => {
      const state = await api.getUpdateState().catch(() => null);
      if (cancelled || !state || state.status !== 'pending') return;
      // Estado pending colgado de un update que NUNCA se aplicó (instalación
      // fallida + watchdog viejo que no marcaba rolled_back): la versión instalada
      // no es la nueva → limpiar el estado sin tocar el exe (rollback restauraría
      // la versión anterior SOBRE la actual instalada).
      if (appVersion && appVersion !== `v${state.new_version}`) {
        await api.markUpdateFailed().catch(() => {});
        return;
      }
      const report = await api.runHealthCheck().catch(() => ({ ok: false, issues: ['run_health_check no disponible'] }));
      if (report.ok) {
        await api.markUpdateOk().catch(() => {});
        if (!cancelled) setUpdateNotice(`Actualizado a la versión ${state.new_version} · todo verificado ✓`);
      } else {
        try {
          await api.rollbackUpdate();
          if (!cancelled) setUpdateNotice('La actualización falló la verificación — se restauró la versión anterior. Tus datos están intactos.');
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        } catch { /* sin versión anterior: seguir con la actual */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, appVersion]);

  // 2) Buscar actualización al arrancar (5s máx; sin internet = silencio).
  // "Ver más tarde" ya NO descarta la versión: si la descargó, al reiniciar
  // se muestra la nota de que está lista (dialog con la descarga hecha).
  useEffect(() => {
    if (role === 'loading') return;
    let cancelled = false;
    (async () => {
      const update = await checkForUpdate();
      if (cancelled || !update) return;
      setPendingUpdate(update);
      setShowUpdate(true);
      if (update.version === downloadedVersion()) {
        setUpdateNotice(`Actualización v${update.version} ya descargada — está lista para instalar.`);
      }
    })();
    return () => { cancelled = true; };
  }, [role]);

  // 3) Check manual desde el Centro de Ayuda ("Revisar actualizaciones")
  useEffect(() => {
    const onCheck = () => {
      checkForUpdate().then(update => {
        if (update) {
          setPendingUpdate(update);
          setShowUpdate(true);
        } else {
          toast.info('Ya tienes la última versión');
        }
      });
    };
    window.addEventListener('registro:check-update', onCheck);
    return () => window.removeEventListener('registro:check-update', onCheck);
  }, []);

  // Navegación rápida: Alt+1..9 cambia de pantalla (orden de la sidebar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const n = Number(e.key);
      if (n < 1 || n > 9) return;
      const items = role === 'cashier' ? navItems.filter(i => i.key !== 'dashboard') : navItems;
      const item = items[n - 1];
      if (item) setTab(item.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role]);

  const enterPin = async () => {
    setPinError(null);
    try {
      // F68: si hay personas, se entra con el PIN DE ESA PERSONA (cada una tiene el suyo).
      if (picked) {
        const sesion = await api.verifyUserPin(picked.id, pinInput);
        if (sesion) {
          setWho(picked);
          setRole(sesion.role === 'caja' ? 'cashier' : 'owner');
          setPinInput('');
          setPicked(null);
        } else {
          setPinError('PIN incorrecto');
        }
        return;
      }
      // Compatibilidad (instalación vieja con un PIN suelto, sin personas cargadas)
      const ok = await api.verifyPin(pinInput);
      if (ok) {
        setRole('owner');
        setPinInput('');
      } else {
        setPinError('PIN incorrecto');
      }
    } catch (e) {
      setPinError(e instanceof Error ? e.message : String(e));
    }
  };

  if (role === 'loading') {
    const elegir = (u: AppUser) => { setPicked(u); setPinInput(''); setPinError(null); };
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">Registro — Acceso restringido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* F68 — ACCESO POR PERSONA: se elige quién entra y cada una pone SU PIN. Antes había un
                PIN único y un botón «Entrar como cajera» que no pedía nada. */}
            {people.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  {picked ? 'Poné tu PIN para entrar' : '¿Quién va a usar la caja?'}
                </p>
                {!picked && (
                  <div className="flex flex-col gap-2" data-user-picker>
                    {people.map(u => (
                      <button key={u.id} type="button" data-user-option={u.id} onClick={() => elegir(u)}
                        className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent">
                        <span className="size-9 shrink-0 rounded-full text-white text-xs font-bold flex items-center justify-center"
                          style={{ backgroundColor: u.color || '#0ea5e9' }}>
                          {u.name.trim().slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{u.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {u.role === 'master' ? 'Master (dueño)' : 'Caja'}
                          </span>
                        </span>
                        <Lock className="size-3.5 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
                {picked && (
                  <>
                    <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2" data-user-picked={picked.name}>
                      <span className="size-7 shrink-0 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                        style={{ backgroundColor: picked.color || '#0ea5e9' }}>
                        {picked.name.trim().slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-sm font-medium">{picked.name}</span>
                      <button data-action="cambiar-persona" className="ml-auto text-xs text-muted-foreground underline" onClick={() => { setPicked(null); setPinInput(''); setPinError(null); }}>
                        cambiar
                      </button>
                    </div>
                    <Input
                      type="text" inputMode="numeric" maxLength={4} autoFocus
                      className="text-center text-lg tracking-widest"
                      placeholder="PIN de 4 dígitos"
                      value={pinInput}
                      onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      onKeyDown={e => { if (e.key === 'Enter') enterPin(); }}
                    />
                  </>
                )}
              </>
            ) : (
              <Input
                type="text" inputMode="numeric" maxLength={4} autoFocus
                className="text-center text-lg tracking-widest"
                placeholder="PIN de 4 dígitos"
                value={pinInput}
                onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={e => { if (e.key === 'Enter') enterPin(); }}
              />
            )}
            {pinError && <p className="text-sm text-danger text-center">{pinError}</p>}
            {(picked || people.length === 0) && (
              <Button className="w-full" onClick={enterPin}>Entrar</Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const visibleItems = role === 'cashier' ? navItems.filter(i => i.key !== 'dashboard') : navItems;
  return (
    <div className="flex h-screen bg-background">
      <aside className={cn('border-r border-border bg-sidebar-background flex flex-col shrink-0 shadow-sm transition-all duration-200', collapsed ? 'w-16' : 'w-64')}>
        <div className="px-5 py-5 border-b border-sidebar-border flex items-center justify-between">
          {collapsed ? (
            <div className="w-full flex items-center justify-center">
              <div className="size-9 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <Wrench className="size-5 text-primary-foreground" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <Wrench className="size-5 text-primary-foreground" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-sidebar-accent-foreground leading-tight">Registro</h2>
                <p className="text-[11px] text-sidebar-foreground leading-tight">Sistema de Servicio</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => {
              const n = !c;
              localStorage.setItem('sidebar_collapsed', n ? '1' : '0');
              return n;
            })}
            className="shrink-0 rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
            title={collapsed ? 'Expandir' : 'Colapsar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>

        <nav className="flex-1 flex flex-col gap-1.5 px-3 py-5">
          {visibleItems.map((item, idx) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                title={`${item.label} (Alt+${idx + 1})`}
                className={cn(
                  'relative w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-primary" />
                )}
                <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : '')} />
                <span className={cn(collapsed && 'hidden')}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-sidebar-border flex flex-col gap-2">
          {/* F76 — EL INDICADOR DE SINCRONIZACIÓN: la app se actualiza sola, así que acá se VE que
              está al día («Sincronizado · hace un momento») y cuándo fue el último cambio. El
              `data-sync-version` sube con cada escritura: es lo que miran las pruebas en vivo. */}
          <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center gap-0')}
            data-sync-indicator={sync.version} title={`Última actualización de datos: ${sync.motivo} (${sync.texto})`}>
            <span className={cn('size-2 rounded-full', syncOk ? 'bg-success' : 'bg-warning')} />
            {!collapsed && (
              <span className="text-[11px] text-sidebar-foreground/70 truncate">
                {syncOk ? `Sincronizado · ${sync.texto}` : 'Leyendo datos…'}
              </span>
            )}
          </div>
          <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center gap-0')}>
            <span className="size-2 rounded-full bg-success" />
            {!collapsed && (
              <>
                {/* F68: se ve QUIÉN está en la caja (antes no se sabía quién estaba usando la app). */}
                <span className="text-xs text-sidebar-foreground truncate" title={who ? `${who.name} · ${who.role === 'master' ? 'Master' : 'Caja'}` : 'Local'}>
                  {who ? who.name : 'Local'}
                </span>
                <span className="text-xs text-sidebar-foreground/50">{appVersion || 'v0.1.1'}</span>
              </>
            )}
          </div>
          {/* El dueño puede DEJAR LA SESIÓN BLOQUEADA al levantarse: sin esto la sesión de dueño
              quedaba abierta todo el día (o hasta 12 h) y la cajera podía tocar el catálogo.
              F68: ahora lo puede hacer CUALQUIER persona (la caja también se bloquea al irse). */}
          {(role === 'owner' || role === 'cashier') && (
            <button
              data-action="bloquear-sesion"
              onClick={async () => {
                await api.lockOwner().catch(() => {});
                setRole('loading');
                setWho(null);
                setPicked(null);
                setPinInput('');
                setPinError(null);
                api.getUsers(true).then(setPeople).catch(() => {});
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
              title="Bloquear la sesión (vuelve a la pantalla de acceso)"
            >
              <Lock className="size-3.5 shrink-0" />
              {!collapsed && <span>Bloquear sesión</span>}
            </button>
          )}
        </div>
      </aside>

      {updateNotice && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 shadow-lg">
          {updateNotice}
          <button className="ml-2 text-xs underline" onClick={() => setUpdateNotice(null)}>OK</button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto px-10 py-8">
          <Suspense fallback={<div className="flex items-center justify-center py-24 text-sm text-muted-foreground">Cargando…</div>}>
            {tab === 'dashboard' && <Dashboard />}
            {tab === 'ventas' && <Sales role={role === 'cashier' ? 'cashier' : 'owner'} />}
            {tab === 'servicios' && <Services role={role === 'cashier' ? 'cashier' : 'owner'} />}
            {tab === 'inventario' && <Inventory role={role} />}
            {tab === 'pedidos' && <Pedidos role={role === 'cashier' ? 'cashier' : 'owner'} />}
            {tab === 'clientes' && <Clients />}
            {tab === 'libro' && <DailyLedger role={role} />}
            {tab === 'ayuda' && <Help />}
          </Suspense>
        </div>
      </main>

      <UpdateDialog
        update={pendingUpdate}
        open={showUpdate}
        onOpenChange={o => setShowUpdate(o)}
      />

      {/* avisos de la app (guardados, fusiones, errores de la impresora…): sin este
          componente los toast NO se ven en ningún lado */}
      <Toaster richColors position="top-right" />
    </div>
  );
}

export default App;
