import { useEffect, useState } from 'react';
import { Layers, MoveHorizontal, Package, Tag, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api } from '../db';
import type { Category, InventoryStats, Product } from '../types';
import { ProductForm } from './ProductForm';
import { ProductsTab } from './inventory/ProductsTab';
import { ByModelTab } from './inventory/ByModelTab';
import { MovementsTab } from './inventory/MovementsTab';
import { PricesTab } from './inventory/PricesTab';
import { DuplicatesDialog } from './inventory/DuplicatesDialog';

// MÓDULO ÚNICO de inventario (2026-09-15). Antes había dos pantallas sobre la
// misma tabla ("Inventario" y "Pantallas"); ahora es una sola con pestañas:
//   Productos   → gestión del catálogo (KPIs, filtros, tabla paginada)
//   Por modelo  → consulta "¿qué repuesto le sirve a este teléfono?"
//   Movimientos → auditoría de entradas/salidas con su orden o pedido
//   Precios     → herramientas de datos (solo dueño)
export default function Inventory({ role = 'owner', initialTab = 'productos', initialModel = '' }: {
  role?: 'owner' | 'cashier' | 'loading';
  initialTab?: string;
  initialModel?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [modelQuery, setModelQuery] = useState(initialModel);
  // Sube al guardar/editar/fusionar: hace que las pestañas vuelvan a consultar
  // (antes había que refrescar la app para ver el producto nuevo).
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshAll = () => { loadStats(); setRefreshKey(k => k + 1); };

  const loadStats = () => {
    api.getInventoryStats().then(setStats).catch(() => setStats(null));
  };

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => setCategories([]));
    loadStats();
  }, []);

  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { setModelQuery(initialModel); }, [initialModel]);

  const openByModel = (model: string) => {
    setModelQuery(model);
    setTab('modelo');
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Catálogo, compatibilidad por teléfono, stock real y movimientos — todo en un solo lugar
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => openByModel('')}>
              <Layers data-icon="inline-start" /> Buscar por modelo
            </Button>
            <Button onClick={() => { setEditing(null); setShowForm(true); }}>
              <Package data-icon="inline-start" /> Nuevo producto
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="productos"><Tag data-icon="inline-start" /> Productos</TabsTrigger>
            <TabsTrigger value="modelo"><Layers data-icon="inline-start" /> Por modelo</TabsTrigger>
            <TabsTrigger value="movimientos"><MoveHorizontal data-icon="inline-start" /> Movimientos</TabsTrigger>
            {role === 'owner' && <TabsTrigger value="precios"><Wand2 data-icon="inline-start" /> Ajustes</TabsTrigger>}
          </TabsList>

          <TabsContent value="productos">
            <ProductsTab
              categories={categories}
              stats={stats}
              refreshKey={refreshKey}
              onEdit={p => { setEditing(p); setShowForm(true); }}
              onReviewDuplicates={() => setShowDuplicates(true)}
              onByModel={openByModel}
            />
          </TabsContent>

          <TabsContent value="modelo">
            <ByModelTab refreshKey={refreshKey} initialModel={modelQuery} onEdit={p => { setEditing(p); setShowForm(true); }} />
          </TabsContent>

          <TabsContent value="movimientos">
            <MovementsTab refreshKey={refreshKey} />
          </TabsContent>

          {role === 'owner' && (
            <TabsContent value="precios">
              <PricesTab onChanged={() => { refreshAll(); setTab('productos'); }} />
            </TabsContent>
          )}
        </Tabs>

        {showForm && (
          <ProductForm
            product={editing}
            categories={categories}
            onClose={() => { setShowForm(false); setEditing(null); }}
            onSaved={() => { setShowForm(false); setEditing(null); refreshAll(); }}
          />
        )}

        <DuplicatesDialog
          open={showDuplicates}
          onClose={() => setShowDuplicates(false)}
          onChanged={refreshAll}
        />
      </div>
    </TooltipProvider>
  );
}
