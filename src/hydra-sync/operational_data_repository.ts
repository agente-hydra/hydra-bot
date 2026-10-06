/**
 * src/hydra-sync/operational_data_repository.ts
 * Repositório de dados operacionais do ERP (ordens_servico e veículos).
 * Implementa resolução discriminada de veículos com proibição estrita de rows[0] cego.
 */

import type Database from 'better-sqlite3';
import type {
  CandidateVehicle,
  CandidateOrder,
  VehicleResolutionResult
} from './types/conversation_context_contract.js';

/**
 * Garante a existência da tabela ordens_servico (idempotente).
 */
export function ensureOrdensServicoTable(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ordens_servico (
        os_id TEXT NOT NULL,
        loja_slug TEXT NOT NULL,
        tipo TEXT DEFAULT 'OS',
        status_grid TEXT,
        is_aberta INTEGER NOT NULL DEFAULT 1,
        estado_operacional TEXT DEFAULT 'ABERTA',
        qualidade_dado TEXT DEFAULT 'VALIDADO',
        data_inicio TEXT,
        data_fim TEXT,
        data_inicio_iso TEXT,
        data_fim_iso TEXT,
        dias_no_patio INTEGER DEFAULT 0,
        veiculo TEXT,
        placa TEXT,
        cliente_nome TEXT,
        responsavel TEXT,
        total_os REAL DEFAULT 0,
        valor_pago REAL DEFAULT 0,
        valor_restante REAL DEFAULT 0,
        tem_nf INTEGER DEFAULT 0,
        raw_payload TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (os_id, loja_slug)
      );
      CREATE INDEX IF NOT EXISTS idx_os_aberta_patio ON ordens_servico(loja_slug, is_aberta, dias_no_patio);
      CREATE INDEX IF NOT EXISTS idx_os_veiculo ON ordens_servico(loja_slug, veiculo);
      CREATE INDEX IF NOT EXISTS idx_os_placa ON ordens_servico(loja_slug, placa);
    `);
  } catch (err: any) {
    console.error('[OPERATIONAL_DATA_REPO] Erro ao garantir tabela ordens_servico:', err?.message || err);
  }
}

/**
 * Mapeia registro de banco bruto para CandidateOrder tipada.
 */
export function mapRowToCandidateOrder(row: any): CandidateOrder {
  return {
    osId: String(row.os_id),
    storeSlug: String(row.loja_slug),
    plate: String(row.placa || '').trim(),
    vehicleModel: String(row.veiculo || '').trim(),
    clientName: row.cliente_nome ? String(row.cliente_nome).trim() : undefined,
    statusGrid: String(row.status_grid || 'EM_ANDAMENTO'),
    isOpen: Boolean(row.is_aberta === 1 || row.is_aberta === true),
    daysInYard: Number(row.dias_no_patio) || 0,
    totalAmount: Number(row.total_os) || 0,
    remainingBalance: Number(row.valor_restante) || 0,
    openedAt: row.data_inicio || row.data_inicio_iso || undefined
  };
}

/**
 * Busca candidatos a veículo no ERP por padrão de modelo e discrimina explicitamente o resultado [E2-02].
 *
 * Query SQL parametrizada:
 * SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, valor_restante, dias_no_patio
 * FROM ordens_servico WHERE loja_slug = ? AND veiculo LIKE ?
 *
 * Discriminação estrita:
 * - RESOLVED: exatamente 1 carro retornado -> { status: 'RESOLVED', vehicle, activeOrder }
 * - AMBIGUOUS_VEHICLE: mais de 1 carro retornado -> { status: 'AMBIGUOUS_VEHICLE', candidates, clarificationPrompt } (listando opções com placas)
 * - NO_MATCH: 0 carros -> { status: 'NO_MATCH', reason }
 * - UNAVAILABLE: erro de banco -> { status: 'UNAVAILABLE', technicalError }
 *
 * PROIBIDO usar rows[0] cegamente para mascarar ambiguidade.
 */
export function findVehicleCandidates(
  db: Database.Database,
  storeSlug: string,
  modelPattern: string
): VehicleResolutionResult {
  if (!storeSlug || !modelPattern || !modelPattern.trim()) {
    return {
      status: 'NO_MATCH',
      searchedModel: modelPattern,
      searchedStoreSlug: storeSlug,
      reason: 'Loja ou modelo do veículo não informado.'
    };
  }

  const cleanStore = storeSlug.trim();
  const rawPattern = modelPattern.trim();
  const likePattern = rawPattern.includes('%') ? rawPattern : `%${rawPattern}%`;

  let rows: any[];
  try {
    ensureOrdensServicoTable(db);
    rows = db.prepare(`
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, valor_restante, dias_no_patio, data_inicio, data_inicio_iso
      FROM ordens_servico
      WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?)) AND veiculo LIKE ?
      ORDER BY is_aberta DESC, dias_no_patio DESC, os_id DESC
    `).all(cleanStore, cleanStore, likePattern) as any[];
  } catch (err: any) {
    return {
      status: 'UNAVAILABLE',
      technicalError: err?.message || String(err)
    };
  }

  // 1. Caso 0 carros: NO_MATCH
  if (!rows || rows.length === 0) {
    return {
      status: 'NO_MATCH',
      searchedModel: rawPattern,
      searchedStoreSlug: cleanStore,
      reason: `Nenhum veículo encontrado para o modelo "${rawPattern}" na unidade "${cleanStore}".`
    };
  }

  // 2. Agrupa por veículo físico (chave principal: placa; fallback: os_id se sem placa)
  const vehicleGroups = new Map<string, any[]>();
  for (const row of rows) {
    const plate = (row.placa || '').trim().toUpperCase();
    const groupKey = plate.length > 0 ? plate : `NO_PLATE_${row.os_id}`;
    const group = vehicleGroups.get(groupKey) || [];
    group.push(row);
    vehicleGroups.set(groupKey, group);
  }

  // 3. Caso mais de 1 carro retornado: AMBIGUOUS_VEHICLE (PROIBIDO usar rows[0]!)
  if (vehicleGroups.size > 1) {
    const candidates: CandidateVehicle[] = Array.from(vehicleGroups.entries()).map(([plateKey, vRows]) => {
      // Prioriza a OS aberta mais recente do grupo
      const prime = vRows.find(r => r.is_aberta === 1 || r.is_aberta === true) || vRows[0];
      return {
        plate: (prime.placa || '').trim(),
        model: (prime.veiculo || '').trim(),
        clientName: prime.cliente_nome ? String(prime.cliente_nome).trim() : undefined,
        storeSlug: String(prime.loja_slug),
        lastActiveOsId: String(prime.os_id)
      };
    });

    const lines = candidates.map((c, idx) => {
      const plateDesc = c.plate ? `Placa ${c.plate}` : 'Sem placa';
      const clientDesc = c.clientName ? ` | Cliente: ${c.clientName}` : '';
      return `${idx + 1}. ${c.model} — ${plateDesc} (OS #${c.lastActiveOsId}${clientDesc})`;
    });

    const clarificationPrompt = `Encontrei mais de um veículo para "${rawPattern}" na unidade ${cleanStore}:\n` +
      lines.join('\n') +
      `\nPor favor, confirme a placa ou o número da OS desejada para prosseguir.`;

    return {
      status: 'AMBIGUOUS_VEHICLE',
      candidates,
      clarificationPrompt
    };
  }

  // 4. Caso exatamente 1 carro identificado
  const [, vRows] = Array.from(vehicleGroups.entries())[0];
  const primeRow = vRows.find(r => r.is_aberta === 1 || r.is_aberta === true) || vRows[0];

  const vehicle: CandidateVehicle = {
    plate: (primeRow.placa || '').trim(),
    model: (primeRow.veiculo || '').trim(),
    clientName: primeRow.cliente_nome ? String(primeRow.cliente_nome).trim() : undefined,
    storeSlug: String(primeRow.loja_slug),
    lastActiveOsId: String(primeRow.os_id)
  };

  const openOrders = vRows.filter(r => r.is_aberta === 1 || r.is_aberta === true);

  // Se o mesmo carro tiver mais de uma OS aberta em paralelo: AMBIGUOUS_ORDER
  if (openOrders.length > 1) {
    const candidateOrders = openOrders.map(mapRowToCandidateOrder);
    const orderLines = candidateOrders.map((o, idx) => {
      return `${idx + 1}. OS #${o.osId} — ${o.statusGrid} (${o.daysInYard} dias no pátio | R$ ${o.totalAmount.toFixed(2)})`;
    });
    const clarificationPrompt = `O veículo ${vehicle.model} (Placa ${vehicle.plate || 'N/D'}) possui ${openOrders.length} ordens de serviço abertas:\n` +
      orderLines.join('\n') +
      `\nPor favor, indique o número da OS que deseja consultar.`;

    return {
      status: 'AMBIGUOUS_ORDER',
      vehicle,
      candidateOrders,
      clarificationPrompt
    };
  }

  // Exatamente 1 carro e 1 ordem ativa: RESOLVED
  const activeRow = openOrders[0] || vRows[0];
  const activeOrder: CandidateOrder = mapRowToCandidateOrder(activeRow);

  return {
    status: 'RESOLVED',
    vehicle,
    activeOrder
  };
}

/**
 * Busca ordem de serviço por OS ID e loja.
 */
export function findOrderByOsId(
  db: Database.Database,
  storeSlug: string,
  osId: string
): CandidateOrder | null {
  if (!storeSlug || !osId) return null;
  const cleanStore = storeSlug.trim();
  const cleanOsId = osId.trim();

  try {
    ensureOrdensServicoTable(db);
    const row = db.prepare(`
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, valor_restante, dias_no_patio, data_inicio, data_inicio_iso
      FROM ordens_servico
      WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?)) AND os_id = ?
    `).get(cleanStore, cleanStore, cleanOsId) as any;

    if (!row) return null;
    return mapRowToCandidateOrder(row);
  } catch (err: any) {
    console.error('[OPERATIONAL_DATA_REPO] Erro ao buscar OS por ID:', err?.message || err);
    return null;
  }
}

/**
 * Busca veículo por placa e loja com resolução discriminada.
 */
export function findVehicleByPlate(
  db: Database.Database,
  storeSlug: string,
  plate: string
): VehicleResolutionResult {
  if (!storeSlug || !plate || !plate.trim()) {
    return {
      status: 'NO_MATCH',
      searchedPlate: plate,
      searchedStoreSlug: storeSlug,
      reason: 'Placa ou loja não informada.'
    };
  }

  const cleanStore = storeSlug.trim();
  const cleanPlate = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  let rows: any[];
  try {
    ensureOrdensServicoTable(db);
    rows = db.prepare(`
      SELECT os_id, loja_slug, veiculo, placa, cliente_nome, status_grid, is_aberta, total_os, valor_restante, dias_no_patio, data_inicio, data_inicio_iso
      FROM ordens_servico
      WHERE (loja_slug = ? OR LOWER(loja_slug) = LOWER(?))
        AND UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', '')) = ?
      ORDER BY is_aberta DESC, dias_no_patio DESC, os_id DESC
    `).all(cleanStore, cleanStore, cleanPlate) as any[];
  } catch (err: any) {
    return {
      status: 'UNAVAILABLE',
      technicalError: err?.message || String(err)
    };
  }

  if (!rows || rows.length === 0) {
    return {
      status: 'NO_MATCH',
      searchedPlate: cleanPlate,
      searchedStoreSlug: cleanStore,
      reason: `Nenhum veículo encontrado com a placa "${cleanPlate}" na unidade "${cleanStore}".`
    };
  }

  const prime = rows.find(r => r.is_aberta === 1 || r.is_aberta === true) || rows[0];
  const vehicle: CandidateVehicle = {
    plate: (prime.placa || '').trim(),
    model: (prime.veiculo || '').trim(),
    clientName: prime.cliente_nome ? String(prime.cliente_nome).trim() : undefined,
    storeSlug: String(prime.loja_slug),
    lastActiveOsId: String(prime.os_id)
  };

  const openOrders = rows.filter(r => r.is_aberta === 1 || r.is_aberta === true);
  if (openOrders.length > 1) {
    const candidateOrders = openOrders.map(mapRowToCandidateOrder);
    const orderLines = candidateOrders.map((o, idx) => `${idx + 1}. OS #${o.osId} — ${o.statusGrid}`);
    return {
      status: 'AMBIGUOUS_ORDER',
      vehicle,
      candidateOrders,
      clarificationPrompt: `A placa ${cleanPlate} possui múltiplas OS abertas:\n${orderLines.join('\n')}\nQual ordem deseja consultar?`
    };
  }

  const activeRow = openOrders[0] || rows[0];
  return {
    status: 'RESOLVED',
    vehicle,
    activeOrder: mapRowToCandidateOrder(activeRow)
  };
}
