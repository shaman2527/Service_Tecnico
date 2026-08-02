import { useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Wrench, Package, Users, BookOpen, Smartphone,
  PanelLeftClose, PanelLeftOpen, LifeBuoy, ShoppingBag,
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import Sales from './components/Sales';
import Services from './components/Services';
import Inventory from './components/Inventory';
import Clients from './components/Clients';
import DailyLedger from './components/DailyLedger';
import Catalog from './components/Catalog';
import Help from './components/Help';
import Pedidos from './components/Pedidos';
import { cn } from './lib/utils';
import './index.css';

type Tab = 'dashboard' | 'ventas' | 'servicios' | 'inventario' | 'clientes' | 'libro' | 'pantallas' | 'pedidos' | 'ayuda';

const navItems: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'ventas', label: 'Ventas', icon: ShoppingCart },
  { key: 'servicios', label: 'Servicio Técnico', icon: Wrench },
  { key: 'inventario', label: 'Inventario', icon: Package },
  { key: 'pantallas', label: 'Pantallas', icon: Smartphone },
  { key: 'pedidos', label: 'Pedidos', icon: ShoppingBag },
  { key: 'clientes', label: 'Clientes', icon: Users },
  { key: 'libro', label: 'Libro Diario', icon: BookOpen },
  { key: 'ayuda', label: 'Ayuda', icon: LifeBuoy },
];

function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1');

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
          {navItems.map(item => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
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

        <div className="px-5 py-4 border-t border-sidebar-border">
          <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center gap-0')}>
            <span className="size-2 rounded-full bg-success" />
            {!collapsed && (
              <>
                <span className="text-xs text-sidebar-foreground">Local</span>
                <span className="text-xs text-sidebar-foreground/50">v0.2</span>
              </>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto px-10 py-8">
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'ventas' && <Sales />}
          {tab === 'servicios' && <Services />}
          {tab === 'inventario' && <Inventory />}
          {tab === 'pantallas' && <Catalog />}
          {tab === 'pedidos' && <Pedidos />}
          {tab === 'clientes' && <Clients />}
          {tab === 'libro' && <DailyLedger />}
          {tab === 'ayuda' && <Help />}
        </div>
      </main>
    </div>
  );
}

export default App;
