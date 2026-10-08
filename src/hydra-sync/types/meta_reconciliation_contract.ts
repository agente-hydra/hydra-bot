/**
 * src/hydra-sync/types/meta_reconciliation_contract.ts
 * 
 * Contratos de tipos para reconciliação bidirecional do Mapa de Metas
 * e despacho unificado de relatórios matinais via WhatsApp.
 * Spec: hydra-mapa-metas-reconcile-and-clean-dispatch
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

export interface StoreRevenueSnapshot {
  slug: string;
  nome: string;
  faturamentoTotal: number;
  volumeOS: number;
  ticketMedio: number;
  meta: number;
}

export interface MapaMetasReconciliationSnapshot {
  capturedAt: string;
  faturamentoTotalRede: number;
  totalOSsRede: number;
  stores: Record<string, StoreRevenueSnapshot>;
}

export interface ReconcileDeltaResult {
  hasChanged: boolean;
  initialTotal: number;
  finalTotal: number;
  deltaAmount: number;
  divergentStores: string[];
  storeDeltas: Record<string, { initial: number; final: number; delta: number }>;
}

export interface UnifiedDailyReportsPayload {
  referenceDateStr: string; // Ex: "08/10/2026"
  jurosRedePath: string;    // Ex: "output/Juros Rede - 08-10-2026.xlsx"
  carrosPatioPath: string;  // Ex: "output/relatorios/Carros em Patio - 08-10-2026.xlsx"
  mapaMetasPdfPath: string; // Ex: "output/relatorios/Mapa de Metas - 08-10-2026.pdf"
  targetNumber?: string | string[];
  forceImmediate?: boolean;
}
