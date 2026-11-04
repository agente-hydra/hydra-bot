/**
 * src/hydra-sync/tempario_graph_repository.ts
 * Repositório do Grafo Automotivo, DDL de Tabelas e CTE Recursivo de Deduplicação.
 * Spec 054: Tempário Híbrido Automotivo (Versão 2.0).
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import type Database from 'better-sqlite3';
import type {
  TemparioVehicleRecord,
  TemparioEngineRecord,
  TemparioOperationRecord,
  TemparioEvidenceSourceRecord,
  TemparioSubOperationStep,
  DeduplicatedGraphChainResult,
  ExecutionPhase,
  TemparioDifficulty,
  TemparioEvidenceStatus,
  TemparioPartItem,
  TemparioSourceType,
  LearnedTemparioPackage
} from './types/tempario_contract.js';
import { DEFAULT_HOURLY_RATE } from './types/tempario_contract.js';

/**
 * Garante a criação idempotente das tabelas relacionais do grafo e do FTS5 no SQLite.
 */
export function ensureTemparioTables(db: Database.Database): void {
  db.exec(`
    -- 1. Veículos
    CREATE TABLE IF NOT EXISTS tempario_vehicles (
      vehicle_id TEXT PRIMARY KEY,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      geracao TEXT,
      ano_inicio INTEGER NOT NULL,
      ano_fim INTEGER NOT NULL,
      categoria TEXT NOT NULL DEFAULT 'PASSEIO' CHECK (categoria IN ('PASSEIO', 'SUV', 'UTILITARIO', 'PREMIUM')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tempario_vehicles_lookup
      ON tempario_vehicles(LOWER(marca), LOWER(modelo), ano_inicio, ano_fim);

    -- 2. Motores
    CREATE TABLE IF NOT EXISTS tempario_engines (
      engine_id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      codigo_motor TEXT NOT NULL,
      cilindrada TEXT NOT NULL,
      descricao_comercial TEXT NOT NULL,
      combustivel TEXT NOT NULL DEFAULT 'FLEX' CHECK (combustivel IN ('FLEX', 'GASOLINA', 'DIESEL', 'HIBRIDO', 'ELETRICO')),
      aspiracao TEXT NOT NULL DEFAULT 'TURBO' CHECK (aspiracao IN ('ASPIRADO', 'TURBO', 'BITURBO', 'SUPERCHARGED')),
      valvulas INTEGER NOT NULL DEFAULT 16,
      FOREIGN KEY (vehicle_id) REFERENCES tempario_vehicles(vehicle_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tempario_engines_vehicle
      ON tempario_engines(vehicle_id, codigo_motor);

    -- 3. Fontes de Evidência
    CREATE TABLE IF NOT EXISTS tempario_evidence_sources (
      source_id TEXT PRIMARY KEY,
      tipo_fonte TEXT NOT NULL CHECK (tipo_fonte IN ('MANUAL_OEM', 'BOLETIM_TSB', 'HISTORICO_OS_REDE', 'ESTIMATIVA_EXTERNA')),
      status_evidencia TEXT NOT NULL CHECK (status_evidencia IN ('HOMOLOGADO_OEM', 'HISTORICO_OS_REDE', 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO')),
      nome_documento TEXT NOT NULL,
      versao_revisao TEXT,
      capitulo_secao TEXT,
      pagina_tabela TEXT,
      hash_integridade_sha256 TEXT,
      homologado_por TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 4. Operações de Manutenção
    CREATE TABLE IF NOT EXISTS tempario_operations (
      operation_id TEXT PRIMARY KEY,
      codigo_operacao_oem TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      engine_id TEXT,
      titulo TEXT NOT NULL,
      sinonimos_busca TEXT NOT NULL,
      categoria_servico TEXT NOT NULL,
      tempo_padrao_bruto_horas REAL NOT NULL,
      fator_variacao_motor REAL NOT NULL DEFAULT 1.0,
      grau_dificuldade TEXT NOT NULL DEFAULT 'MEDIO' CHECK (grau_dificuldade IN ('BAIXO', 'MEDIO', 'ALTO', 'ESPECIALISTA')),
      source_id TEXT NOT NULL,
      status_evidencia TEXT NOT NULL CHECK (status_evidencia IN ('HOMOLOGADO_OEM', 'HISTORICO_OS_REDE')),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES tempario_vehicles(vehicle_id),
      FOREIGN KEY (engine_id) REFERENCES tempario_engines(engine_id),
      FOREIGN KEY (source_id) REFERENCES tempario_evidence_sources(source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tempario_ops_vehicle_cat
      ON tempario_operations(vehicle_id, engine_id, categoria_servico);

    -- 5. Sub-operações
    CREATE TABLE IF NOT EXISTS tempario_suboperations (
      subop_id TEXT PRIMARY KEY,
      codigo_etapa TEXT NOT NULL,
      titulo TEXT NOT NULL,
      descricao_tecnica TEXT NOT NULL,
      fase_execucao TEXT NOT NULL CHECK (fase_execucao IN ('DESMONTAGEM', 'EXECUCAO', 'REMONTAGEM', 'TESTE_AJUSTE')),
      tempo_horas REAL NOT NULL,
      ferramentas_json TEXT NOT NULL DEFAULT '[]',
      torque_especificado TEXT,
      is_acesso_compartilhado INTEGER NOT NULL DEFAULT 0
    );

    -- 6. Arestas de Dependência
    CREATE TABLE IF NOT EXISTS tempario_dependencies_edges (
      edge_id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL,
      from_node_type TEXT NOT NULL CHECK (from_node_type IN ('OPERATION', 'SUBOP')),
      to_subop_id TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('TEM_SUBOP', 'DEPENDE_ACESSO', 'USAR_FERRAMENTA', 'VARIA_POR_MOTOR', 'FONTE_EVIDENCIA', 'POS_REQUISITO')),
      ordem_local INTEGER NOT NULL,
      obrigatorio INTEGER NOT NULL DEFAULT 1,
      condicao_motor_id TEXT,
      FOREIGN KEY (to_subop_id) REFERENCES tempario_suboperations(subop_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tempario_edges_from
      ON tempario_dependencies_edges(from_node_type, from_node_id, ordem_local);
    CREATE INDEX IF NOT EXISTS idx_tempario_edges_to
      ON tempario_dependencies_edges(to_subop_id);

    -- 7. Chunks de Procedimentos para RAG
    CREATE TABLE IF NOT EXISTS tempario_procedure_chunks (
      chunk_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      engine_id TEXT,
      source_id TEXT NOT NULL,
      titulo_contexto TEXT NOT NULL,
      conteudo_texto TEXT NOT NULL,
      metadados_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (operation_id) REFERENCES tempario_operations(operation_id) ON DELETE CASCADE,
      FOREIGN KEY (vehicle_id) REFERENCES tempario_vehicles(vehicle_id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES tempario_evidence_sources(source_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS tempario_fts USING fts5(
      chunk_id UNINDEXED,
      operation_id UNINDEXED,
      titulo_contexto,
      conteudo_texto,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- 8. Quarentena de Estimativas Externas
    CREATE TABLE IF NOT EXISTS tempario_external_estimates_staging (
      estimate_id TEXT PRIMARY KEY,
      veiculo_informado TEXT NOT NULL,
      motor_informado TEXT,
      ano_informado INTEGER,
      servico_solicitado TEXT NOT NULL,
      tempo_estimado_horas REAL NOT NULL,
      passos_inferidos_json TEXT NOT NULL,
      status_evidencia TEXT NOT NULL DEFAULT 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'
        CHECK (status_evidencia = 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO'),
      requested_by_phone TEXT,
      loja_slug TEXT,
      confidence_score REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 9. Associativa de Peças por Operação (Spec 061)
    CREATE TABLE IF NOT EXISTS tempario_operation_parts (
      part_item_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      nome_peca TEXT NOT NULL,
      codigo_referencia TEXT,
      quantidade REAL NOT NULL DEFAULT 1,
      unidade TEXT NOT NULL DEFAULT 'UN',
      obrigatoria INTEGER NOT NULL DEFAULT 1,
      especificacao_tecnica TEXT,
      observacao TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (operation_id) REFERENCES tempario_operations(operation_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tempario_op_parts
      ON tempario_operation_parts(operation_id);
  `);
}

/**
 * Garante a tabela virtual sqlite-vec de chunks do tempário se a extensão estiver ativa.
 */
export function ensureTemparioVectorTable(db: Database.Database): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_tempario_chunks USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[384]
      );
    `);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valida se uma marca e modelo de veículo são reais e seguros para persistência ou busca no catálogo,
 * bloqueando placeholders genéricos ("Veículo", "Veículo Passeio", "Nacional", "Multimarcas", etc.).
 */
export function isValidVehicleForPersistence(marca?: string, modelo?: string): boolean {
  if (!modelo || typeof modelo !== 'string') return false;
  const normModelo = modelo.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normMarca = (marca || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (normModelo.length < 2) return false;
  if (normModelo.includes('??') || normMarca.includes('??')) return false;

  const INVALID_MODELS = new Set([
    'veiculo',
    'veiculo passeio',
    'veiculo nao catalogado',
    'nacional',
    'multimarcas',
    'desconhecido',
    'carro',
    'automovel',
    'undefined',
    'null',
    'any',
    'padrao'
  ]);

  if (INVALID_MODELS.has(normModelo)) return false;
  if (normModelo.startsWith('veiculo ') || normModelo.endsWith(' passeio')) return false;

  // Bloqueia se o modelo contiver uma placa crua misturada
  if (/\b[a-z]{3}-?[0-9][a-z0-9][0-9]{2}\b/i.test(normModelo)) return false;

  if (marca !== undefined) {
    const INVALID_BRANDS = new Set(['veiculo', 'veiculo passeio', 'nacional', 'multimarcas', 'desconhecido', 'undefined', 'null']);
    if (INVALID_BRANDS.has(normMarca)) return false;
  }

  return true;
}

/**
 * Expurga registros fantasma, genéricos ou corrompidos (como "Veículo Passeio", "Nacional TRACKER 2002-2012",
 * ou operações de 1 passo genérico "(Pesquisa Técnica Web)") do catálogo SQLite.
 */
export function purgePollutedTemparioCatalog(db: Database.Database): void {
  ensureTemparioTables(db);

  const tx = db.transaction(() => {
    const pollutedVehicleFilter = `
      vehicle_id IN (
        'veh_veculo_veculopasseio_2002_2012',
        'veh_nacional_veculo_2002_2012',
        'veh_nacional_tracker_2002_2012',
        'veh_nacional_corsa_2002_2012'
      )
      OR LOWER(marca) IN ('veículo', 'veiculo', 'nacional', 'multimarcas', 'desconhecido')
      OR LOWER(modelo) IN ('veículo', 'veiculo', 'veículo passeio', 'veiculo passeio', 'veículo não catalogado', 'nacional', 'multimarcas')
      OR modelo LIKE '%??%'
    `;

    // 1. Remove operações vinculadas a veículos poluídos ou com IDs corrompidos (antes de deletar tempario_vehicles por FK)
    db.prepare(`
      DELETE FROM tempario_operations
      WHERE vehicle_id IN (SELECT vehicle_id FROM tempario_vehicles WHERE ${pollutedVehicleFilter})
         OR operation_id LIKE 'op_veculo_%'
         OR operation_id LIKE 'op_nacional_%'
    `).run();

    // 2. Remove sub-operações de 1 etapa genérica "(Pesquisa Técnica Web)"
    db.prepare(`
      DELETE FROM tempario_suboperations
      WHERE titulo LIKE '%(Pesquisa Técnica Web)%'
         OR codigo_etapa = 'WEB-EST-01'
    `).run();

    // 3. Remove motores, arestas, peças e chunks órfãos ou vinculados a veículos poluídos
    db.prepare(`
      DELETE FROM tempario_engines
      WHERE vehicle_id IN (SELECT vehicle_id FROM tempario_vehicles WHERE ${pollutedVehicleFilter})
    `).run();

    db.prepare(`
      DELETE FROM tempario_operation_parts
      WHERE operation_id NOT IN (SELECT operation_id FROM tempario_operations)
    `).run();

    db.prepare(`
      DELETE FROM tempario_procedure_chunks
      WHERE operation_id NOT IN (SELECT operation_id FROM tempario_operations)
         OR vehicle_id IN (SELECT vehicle_id FROM tempario_vehicles WHERE ${pollutedVehicleFilter})
    `).run();

    db.prepare(`
      DELETE FROM tempario_dependencies_edges
      WHERE (from_node_type = 'OPERATION' AND from_node_id NOT IN (SELECT operation_id FROM tempario_operations))
         OR to_subop_id NOT IN (SELECT subop_id FROM tempario_suboperations)
    `).run();

    // 4. Agora remove os veículos fantasma / genéricos sem violar FOREIGN KEY
    db.prepare(`
      DELETE FROM tempario_vehicles
      WHERE ${pollutedVehicleFilter}
    `).run();

    // 5. Re-sincroniza FTS5
    db.prepare('DELETE FROM tempario_fts').run();
    db.prepare(`
      INSERT INTO tempario_fts (chunk_id, operation_id, titulo_contexto, conteudo_texto)
      SELECT chunk_id, operation_id, titulo_contexto, conteudo_texto FROM tempario_procedure_chunks
    `).run();
  });

  tx();
}

/**
 * Popula os dados canônicos iniciais homologados do tempário (incluindo o caso clássico VW Golf 1.4 TSI 2020).
 */
export function seedCanonicalTemparioCatalog(db: Database.Database): void {
  ensureTemparioTables(db);
  purgePollutedTemparioCatalog(db);

  const insertVehicle = db.prepare(`
    INSERT INTO tempario_vehicles (vehicle_id, marca, modelo, geracao, ano_inicio, ano_fim, categoria)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vehicle_id) DO UPDATE SET
      marca = excluded.marca, modelo = excluded.modelo, geracao = excluded.geracao,
      ano_inicio = excluded.ano_inicio, ano_fim = excluded.ano_fim, categoria = excluded.categoria
  `);

  const insertEngine = db.prepare(`
    INSERT INTO tempario_engines (engine_id, vehicle_id, codigo_motor, cilindrada, descricao_comercial, combustivel, aspiracao, valvulas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(engine_id) DO UPDATE SET
      codigo_motor = excluded.codigo_motor, cilindrada = excluded.cilindrada,
      descricao_comercial = excluded.descricao_comercial, combustivel = excluded.combustivel,
      aspiracao = excluded.aspiracao, valvulas = excluded.valvulas
  `);

  const insertSource = db.prepare(`
    INSERT INTO tempario_evidence_sources (source_id, tipo_fonte, status_evidencia, nome_documento, versao_revisao, capitulo_secao, pagina_tabela, homologado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      nome_documento = excluded.nome_documento, status_evidencia = excluded.status_evidencia,
      capitulo_secao = excluded.capitulo_secao, pagina_tabela = excluded.pagina_tabela
  `);

  const insertSubOp = db.prepare(`
    INSERT INTO tempario_suboperations (subop_id, codigo_etapa, titulo, descricao_tecnica, fase_execucao, tempo_horas, ferramentas_json, torque_especificado, is_acesso_compartilhado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subop_id) DO UPDATE SET
      titulo = excluded.titulo, descricao_tecnica = excluded.descricao_tecnica,
      fase_execucao = excluded.fase_execucao, tempo_horas = excluded.tempo_horas,
      ferramentas_json = excluded.ferramentas_json, torque_especificado = excluded.torque_especificado,
      is_acesso_compartilhado = excluded.is_acesso_compartilhado
  `);

  const insertOp = db.prepare(`
    INSERT INTO tempario_operations (operation_id, codigo_operacao_oem, vehicle_id, engine_id, titulo, sinonimos_busca, categoria_servico, tempo_padrao_bruto_horas, fator_variacao_motor, grau_dificuldade, source_id, status_evidencia)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_id) DO UPDATE SET
      titulo = excluded.titulo, sinonimos_busca = excluded.sinonimos_busca,
      tempo_padrao_bruto_horas = excluded.tempo_padrao_bruto_horas,
      fator_variacao_motor = excluded.fator_variacao_motor,
      grau_dificuldade = excluded.grau_dificuldade,
      source_id = excluded.source_id,
      status_evidencia = excluded.status_evidencia
  `);

  const insertEdge = db.prepare(`
    INSERT INTO tempario_dependencies_edges (edge_id, from_node_id, from_node_type, to_subop_id, relation_type, ordem_local, obrigatorio, condicao_motor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(edge_id) DO UPDATE SET
      relation_type = excluded.relation_type, ordem_local = excluded.ordem_local,
      obrigatorio = excluded.obrigatorio, condicao_motor_id = excluded.condicao_motor_id
  `);

  const insertChunk = db.prepare(`
    INSERT INTO tempario_procedure_chunks (chunk_id, operation_id, vehicle_id, engine_id, source_id, titulo_contexto, conteudo_texto, metadados_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET
      titulo_contexto = excluded.titulo_contexto, conteudo_texto = excluded.conteudo_texto,
      metadados_json = excluded.metadados_json
  `);

  const insertPart = db.prepare(`
    INSERT INTO tempario_operation_parts (part_item_id, operation_id, nome_peca, codigo_referencia, quantidade, unidade, obrigatoria, especificacao_tecnica, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(part_item_id) DO UPDATE SET
      nome_peca = excluded.nome_peca, codigo_referencia = excluded.codigo_referencia,
      quantidade = excluded.quantidade, unidade = excluded.unidade,
      obrigatoria = excluded.obrigatoria, especificacao_tecnica = excluded.especificacao_tecnica,
      observacao = excluded.observacao
  `);

  const tx = db.transaction(() => {
    // 1. Veículo: VW Golf MK7 (2014-2021)
    insertVehicle.run('vw_golf_mk7_2014_2021', 'Volkswagen', 'Golf', 'MK7 / MK7.5', 2014, 2021, 'PASSEIO');

    // 2. Motor: EA211 1.4 TSI
    insertEngine.run('vw_ea211_14_tsi', 'vw_golf_mk7_2014_2021', 'EA211', '1.4', '1.4 16V TSI Turbo', 'FLEX', 'TURBO', 16);

    // 3. Fontes de Evidência
    insertSource.run(
      'src_vw_elsapro_golf_mk7_gr94',
      'MANUAL_OEM',
      'HOMOLOGADO_OEM',
      'Manual Oficial de Reparações VW ElsaPro / Elwin — Golf MK7',
      'Edição 08.2020',
      'Grupo 94 — Sistema de Iluminação Externa',
      'Seção 94-1 / Operação 94151900',
      'ENGENHARIA_TORK'
    );

    insertSource.run(
      'src_vw_elsapro_golf_mk7_gr19',
      'MANUAL_OEM',
      'HOMOLOGADO_OEM',
      'Manual Oficial de Reparações VW ElsaPro / Elwin — Golf MK7',
      'Edição 08.2020',
      'Grupo 19 — Sistema de Arrefecimento do Motor',
      'Seção 19-2 / Operação 19381900',
      'ENGENHARIA_TORK'
    );

    // 4. Sub-operações
    insertSubOp.run(
      'sub_remover_parachoque_golf_mk7',
      '6310-1900',
      'Remover para-choque dianteiro',
      'Soltar fixadores Torx T25 nas caixas de roda, grade superior do radiador e defletor inferior.',
      'DESMONTAGEM',
      0.40,
      JSON.stringify(['Chave Torx T25', 'Espátula de nylon']),
      'Fixadores plásticos e parafusos T25',
      1
    );

    insertSubOp.run(
      'sub_desconectar_chicote_farol_golf_mk7',
      '9415-0100',
      'Desconectar chicote elétrico dos faróis',
      'Destravar trava de segurança do chicote VAG de 14 pinos e afastar conector.',
      'DESMONTAGEM',
      0.10,
      JSON.stringify(['Extrator de conectores VAG']),
      'Sem torque',
      0
    );

    insertSubOp.run(
      'sub_drenar_arrefecimento_golf_mk7',
      '1938-0100',
      'Drenar fluido e soltar mangueiras de arrefecimento',
      'Abrir dreno inferior do radiador, drenar líquido G13 e desconectar engates rápidos.',
      'DESMONTAGEM',
      0.45,
      JSON.stringify(['Alicate para abraçadeiras elásticas', 'Bandeja coletora de fluídos']),
      'Braçadeiras de retenção',
      0
    );

    insertSubOp.run(
      'sub_trocar_bloco_farol_esq_golf_mk7',
      '9415-1900',
      'Remover suporte e substituir farol dianteiro esquerdo',
      'Soltar os 3 parafusos de sustentação Torx T30 e retirar farol esquerdo substituindo pelo novo.',
      'EXECUCAO',
      0.40,
      JSON.stringify(['Chave Torx T30', 'Torquímetro de precisão']),
      '8 Nm nos parafusos de fixação',
      0
    );

    insertSubOp.run(
      'sub_trocar_radiador_golf_mk7',
      '1938-1900',
      'Substituir colmeia do radiador principal',
      'Desacoplar condensador do ar-condicionado, retirar radiador defeituoso e assentar unidade nova.',
      'EXECUCAO',
      0.75,
      JSON.stringify(['Chave Torx T30', 'Chave 10mm']),
      '10 Nm nos suportes de borracha',
      0
    );

    insertSubOp.run(
      'sub_reinstalar_parachoque_golf_mk7',
      '6310-2000',
      'Reinstalar para-choque dianteiro e alinhar vãos',
      'Encaixar guias laterais dos para-lamas, reaparafusar fixadores e alinhar grade superior.',
      'REMONTAGEM',
      0.35,
      JSON.stringify(['Chave Torx T25', 'Espátula de alinhamento']),
      'Torx T25: 4 Nm',
      1
    );

    insertSubOp.run(
      'sub_testar_alinhar_farol_golf_mk7',
      '9415-0200',
      'Testar funcionamento elétrico e alinhar facho óptico',
      'Acionar luzes, validar DRL/seta e calibrar facho alto/baixo em regloscópio.',
      'TESTE_AJUSTE',
      0.15,
      JSON.stringify(['Regloscópio óptico']),
      'Regulagem manual no parafuso de alinhamento',
      0
    );

    insertSubOp.run(
      'sub_abastecer_sangrar_arrefecimento_golf_mk7',
      '1938-0200',
      'Abastecer aditivo G13, pressurizar e sangrar sistema',
      'Abastecer solução arrefecedora a vácuo, aquecer até acionar ventoinha e verificar ausência de ar.',
      'TESTE_AJUSTE',
      0.45,
      JSON.stringify(['Equipamento de vácuo de arrefecimento', 'Refratômetro']),
      'Tampa do reservatório: 1.4 bar',
      0
    );

    // 5. Operações
    // Operação 1: Farol Esquerdo (Bruto: 0.40 + 0.10 + 0.40 + 0.35 + 0.15 = 1.40h)
    insertOp.run(
      'op_vw_golf_14tsi_troca_farol_esq',
      '9415-1900-ESQ',
      'vw_golf_mk7_2014_2021',
      'vw_ea211_14_tsi',
      'Substituição do Farol Dianteiro Esquerdo',
      'trocar farol esquerdo, troca bloco optico dianteiro, farol golf tsi',
      'ELETRICA_ILUMINACAO',
      1.40,
      1.0,
      'MEDIO',
      'src_vw_elsapro_golf_mk7_gr94',
      'HOMOLOGADO_OEM'
    );

    // Operação 2: Radiador (Bruto: 0.40 + 0.45 + 0.75 + 0.35 + 0.45 = 2.40h)
    insertOp.run(
      'op_vw_golf_14tsi_troca_radiador',
      '1938-1900-RAD',
      'vw_golf_mk7_2014_2021',
      'vw_ea211_14_tsi',
      'Substituição do Radiador de Arrefecimento',
      'trocar radiador, troca colmeia radiador, arrefecimento golf tsi',
      'ARREFECIMENTO',
      2.40,
      1.0,
      'MEDIO',
      'src_vw_elsapro_golf_mk7_gr19',
      'HOMOLOGADO_OEM'
    );

    // 6. Arestas do Farol
    insertEdge.run('edge_farol_1', 'op_vw_golf_14tsi_troca_farol_esq', 'OPERATION', 'sub_remover_parachoque_golf_mk7', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_farol_2', 'op_vw_golf_14tsi_troca_farol_esq', 'OPERATION', 'sub_desconectar_chicote_farol_golf_mk7', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_farol_3', 'op_vw_golf_14tsi_troca_farol_esq', 'OPERATION', 'sub_trocar_bloco_farol_esq_golf_mk7', 'TEM_SUBOP', 30, 1, null);
    insertEdge.run('edge_farol_4', 'op_vw_golf_14tsi_troca_farol_esq', 'OPERATION', 'sub_reinstalar_parachoque_golf_mk7', 'TEM_SUBOP', 40, 1, null);
    insertEdge.run('edge_farol_5', 'op_vw_golf_14tsi_troca_farol_esq', 'OPERATION', 'sub_testar_alinhar_farol_golf_mk7', 'TEM_SUBOP', 50, 1, null);

    // Dependência física de acesso: para trocar farol é preciso remover para-choque
    insertEdge.run('edge_farol_dep_acesso', 'sub_trocar_bloco_farol_esq_golf_mk7', 'SUBOP', 'sub_remover_parachoque_golf_mk7', 'DEPENDE_ACESSO', 5, 1, null);

    // 7. Arestas do Radiador
    insertEdge.run('edge_radiador_1', 'op_vw_golf_14tsi_troca_radiador', 'OPERATION', 'sub_remover_parachoque_golf_mk7', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_radiador_2', 'op_vw_golf_14tsi_troca_radiador', 'OPERATION', 'sub_drenar_arrefecimento_golf_mk7', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_radiador_3', 'op_vw_golf_14tsi_troca_radiador', 'OPERATION', 'sub_trocar_radiador_golf_mk7', 'TEM_SUBOP', 30, 1, null);
    insertEdge.run('edge_radiador_4', 'op_vw_golf_14tsi_troca_radiador', 'OPERATION', 'sub_reinstalar_parachoque_golf_mk7', 'TEM_SUBOP', 40, 1, null);
    insertEdge.run('edge_radiador_5', 'op_vw_golf_14tsi_troca_radiador', 'OPERATION', 'sub_abastecer_sangrar_arrefecimento_golf_mk7', 'TEM_SUBOP', 50, 1, null);

    // Dependência física de acesso do radiador
    insertEdge.run('edge_rad_dep_acesso', 'sub_trocar_radiador_golf_mk7', 'SUBOP', 'sub_remover_parachoque_golf_mk7', 'DEPENDE_ACESSO', 5, 1, null);

    // 8. Chunks para Busca Híbrida e FTS5
    insertChunk.run(
      'chk_golf_mk7_farol_esq',
      'op_vw_golf_14tsi_troca_farol_esq',
      'vw_golf_mk7_2014_2021',
      'vw_ea211_14_tsi',
      'src_vw_elsapro_golf_mk7_gr94',
      'Volkswagen Golf MK7 1.4 TSI — Substituição do Farol Dianteiro Esquerdo',
      'Procedimento oficial para troca do farol dianteiro esquerdo do VW Golf MK7 1.4 TSI. Requer remoção do para-choque dianteiro, desconexão do chicote elétrico de 14 pinos, soltura dos parafusos Torx T30 (torque 8 Nm) e calibração final do facho com regloscópio.',
      JSON.stringify({
        marca: 'Volkswagen',
        modelo: 'Golf',
        geracao: 'MK7',
        anoInicio: 2014,
        anoFim: 2021,
        motor: 'EA211 1.4 TSI',
        categoria: 'ELETRICA_ILUMINACAO',
        tempoHoras: 1.40
      })
    );

    insertChunk.run(
      'chk_golf_mk7_radiador',
      'op_vw_golf_14tsi_troca_radiador',
      'vw_golf_mk7_2014_2021',
      'vw_ea211_14_tsi',
      'src_vw_elsapro_golf_mk7_gr19',
      'Volkswagen Golf MK7 1.4 TSI — Substituição do Radiador de Arrefecimento',
      'Procedimento oficial para substituição do radiador de arrefecimento do VW Golf MK7 1.4 TSI. Exige desmontagem do para-choque dianteiro, drenagem do líquido de arrefecimento G13, desengate das mangueiras, desacoplamento do condensador de AC, reinstalação e sangria pressurizada a vácuo.',
      JSON.stringify({
        marca: 'Volkswagen',
        modelo: 'Golf',
        geracao: 'MK7',
        anoInicio: 2014,
        anoFim: 2021,
        motor: 'EA211 1.4 TSI',
        categoria: 'ARREFECIMENTO',
        tempoHoras: 2.40
      })
    );

    // 9. Peças Associadas: VW Golf MK7 1.4 TSI
    insertPart.run('part_golf_farol_bloco', 'op_vw_golf_14tsi_troca_farol_esq', 'Bloco óptico do farol dianteiro esquerdo', '5G1-941-035', 1, 'UN', 1, 'Farol dianteiro Full LED/Xenon OEM', null);
    insertPart.run('part_golf_farol_lampada', 'op_vw_golf_14tsi_troca_farol_esq', 'Lâmpada do farol', 'N-107-218-01', 1, 'UN', 0, 'Preventiva recomendada', null);
    insertPart.run('part_golf_rad_radiador', 'op_vw_golf_14tsi_troca_radiador', 'Radiador de arrefecimento do motor', '5Q0-121-251-GG', 1, 'UN', 1, 'Radiador de alumínio brasado', null);
    insertPart.run('part_golf_rad_aditivo', 'op_vw_golf_14tsi_troca_radiador', 'Aditivo de arrefecimento G13 concentrado', 'G-013-A8J-M1', 3, 'L', 1, 'Norma VW TL 774 J (G13)', 'Mistura 50/50 com água desmineralizada');
    insertPart.run('part_golf_rad_agua', 'op_vw_golf_14tsi_troca_radiador', 'Água desmineralizada', 'AGUA-DESM-1L', 3, 'L', 1, 'Pureza industrial desmineralizada', null);
    insertPart.run('part_golf_rad_abracadeiras', 'op_vw_golf_14tsi_troca_radiador', 'Abraçadeiras elásticas das mangueiras', 'N-906-870-01', 2, 'UN', 1, 'Abraçadeiras 32mm', null);

    // ==========================================
    // PLATAFORMA 2: GM Onix Plus 1.0 12V Turbo (2020-2025)
    // ==========================================
    insertVehicle.run('gm_onix_plus_2020_2025', 'Chevrolet', 'Onix Plus', 'G2', 2020, 2025, 'PASSEIO');
    insertEngine.run('gm_css_prime_10_turbo', 'gm_onix_plus_2020_2025', 'CSS Prime 1.0 Turbo', '1.0', '1.0 12V Ecotec Turbo Flex', 'FLEX', 'TURBO', 12);
    insertSource.run(
      'src_gm_tis_onix_turbo',
      'MANUAL_OEM',
      'HOMOLOGADO_OEM',
      'Manual Oficial GM Chevrolet TIS — Linha Onix 1.0 Turbo',
      'Edição 2023',
      'Grupo 06 — Distribuição e Motor',
      'Seção 06-1 / Operação 062100',
      'ENGENHARIA_TORK'
    );

    insertSubOp.run(
      'sub_onix_desmontar_acesso_frontal',
      '06-2101',
      'Remoção do cofre dianteiro, suporte do motor e proteções laterais',
      'Soltar proteções plásticas, calçar motor e soltar suporte lateral do motor.',
      'DESMONTAGEM',
      1.30,
      JSON.stringify(['Chave Torx T30', 'Chave E-Torx E12', 'Cavalete suporte de motor']),
      'Parafusos do cofre e suporte',
      1
    );

    insertSubOp.run(
      'sub_onix_drenar_oleo',
      '06-2102',
      'Drenar óleo do cárter e inspecionar resíduos da correia',
      'Drenar lubrificante e verificar tela do pescador de óleo.',
      'DESMONTAGEM',
      0.20,
      JSON.stringify(['Chave Allen 8mm', 'Bandeja coletora de fluídos']),
      'Bujão do cárter: 14 Nm',
      0
    );

    insertSubOp.run(
      'sub_onix_fasagem_trava_volante',
      '06-2103',
      'Instalar ferramentas de fasagem do comando e trava de volante',
      'Travar árvores de comando na posição de PMS e travar cremalheira com régua Raven.',
      'DESMONTAGEM',
      0.50,
      JSON.stringify(['Ferramenta de fasagem Raven 131003', 'Trava de volante do motor']),
      'Fixação da régua de fasagem',
      1
    );

    insertSubOp.run(
      'sub_onix_trocar_correia_tensor',
      '06-2104',
      'Substituir correia dentada banhada, tensor e junta frontal',
      'Remover correia desgastada, assentar correia nova, substituir tensor e aplicar torque.',
      'EXECUCAO',
      0.90,
      JSON.stringify(['Torquímetro de precisão 1/2', 'Espátula de vedação']),
      '25 Nm no parafuso do tensor',
      0
    );

    insertSubOp.run(
      'sub_onix_drenar_arrefecimento',
      '06-1931',
      'Drenar líquido de arrefecimento do radiador',
      'Soltar mangueira inferior do radiador e drenar aditivo antigo.',
      'DESMONTAGEM',
      0.15,
      JSON.stringify(['Alicate para abraçadeiras elásticas', 'Bandeja coletora de fluídos']),
      'Abraçadeira de arrefecimento',
      0
    );

    insertSubOp.run(
      'sub_onix_trocar_bomba_dagua',
      '06-1932',
      "Remover e substituir bomba d'água e junta de vedação",
      'Soltar parafusos da bomba velha, limpar face do bloco e assentar nova bomba com junta.',
      'EXECUCAO',
      0.30,
      JSON.stringify(['Chave Torx T30', 'Torquímetro']),
      "10 Nm nos parafusos da bomba d'água",
      0
    );

    insertSubOp.run(
      'sub_onix_remontar_acesso_frontal',
      '06-2105',
      'Reinstalar tampa de distribuição, suporte de motor e periféricos',
      'Aplicar vedador na tampa frontal, fechar distribuição e reinstalar coxim do motor.',
      'REMONTAGEM',
      1.30,
      JSON.stringify(['Chave Torx T30', 'Torquímetro']),
      '55 Nm no suporte do motor',
      1
    );

    insertSubOp.run(
      'sub_onix_abastecer_oleo',
      '06-2106',
      'Abastecer com óleo Dexos 1 Gen 3 0W20 e trocar filtro',
      'Substituir elemento filtrante e abastecer 4L de óleo homologado.',
      'REMONTAGEM',
      0.10,
      JSON.stringify(['Chave saca-filtro de óleo']),
      'Filtro: aperto manual',
      0
    );

    insertSubOp.run(
      'sub_onix_abastecer_arrefecimento',
      '06-1933',
      'Abastecer líquido Dex-Cool e efetuar sangria do sistema',
      'Abastecer aditivo Dex-Cool diluído e purgar ar do circuito.',
      'REMONTAGEM',
      0.15,
      JSON.stringify(['Equipamento de sangria a vácuo']),
      'Tampa reservatório: 1.4 bar',
      0
    );

    insertSubOp.run(
      'sub_onix_teste_funcional',
      '06-2107',
      'Teste funcional de sincronismo, scanner OBD2 e verificação de estanqueidade',
      'Dar partida, checar parâmetros de avanço de ignição via scanner e checar vazamentos.',
      'TESTE_AJUSTE',
      0.20,
      JSON.stringify(['Scanner automotivo OBD2']),
      'Sem torque',
      0
    );

    insertOp.run(
      'op_gm_onix_troca_correia_banhada',
      'GM-06-2100',
      'gm_onix_plus_2020_2025',
      'gm_css_prime_10_turbo',
      'Substituição da Correia Dentada Banhada a Óleo e Tensores',
      'troca correia dentada onix, correia banhada a oleo onix turbo, distribuicao onix plus',
      'DISTRIBUICAO_MOTOR',
      4.50,
      1.0,
      'ESPECIALISTA',
      'src_gm_tis_onix_turbo',
      'HOMOLOGADO_OEM'
    );

    insertOp.run(
      'op_gm_onix_troca_bomba_dagua',
      'GM-06-1930',
      'gm_onix_plus_2020_2025',
      'gm_css_prime_10_turbo',
      "Substituição da Bomba d'Água do Motor",
      'troca bomba dagua onix, bomba dagua onix turbo, arrefecimento onix plus',
      'ARREFECIMENTO',
      3.20,
      1.0,
      'MEDIO',
      'src_gm_tis_onix_turbo',
      'HOMOLOGADO_OEM'
    );

    // Arestas Correia Onix (1.30 + 0.20 + 0.50 + 0.90 + 1.30 + 0.10 + 0.20 = 4.50h)
    insertEdge.run('edge_onix_c1', 'op_gm_onix_troca_correia_banhada', 'OPERATION', 'sub_onix_desmontar_acesso_frontal', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_onix_c2', 'op_gm_onix_troca_correia_banhada', 'OPERATION', 'sub_onix_drenar_oleo', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_onix_c3', 'op_gm_onix_troca_correia_banhada', 'OPERATION', 'sub_onix_fasagem_trava_volante', 'TEM_SUBOP', 30, 1, null);
    insertEdge.run('edge_onix_c4', 'op_gm_onix_troca_correia_banhada', 'OPERATION', 'sub_onix_trocar_correia_tensor', 'TEM_SUBOP', 40, 1, null);
    insertEdge.run('edge_onix_c5', 'op_gm_onix_troca_correia_banhada', 'OPERATION', 'sub_onix_remontar_acesso_frontal', 'TEM_SUBOP', 50, 1, null);
    insertEdge.run('edge_onix_c6', 'op_gm_onix_troca_correia_banhada', 'OPERATION', 'sub_onix_abastecer_oleo', 'TEM_SUBOP', 60, 1, null);
    insertEdge.run('edge_onix_c7', 'op_gm_onix_troca_correia_banhada', 'OPERATION', 'sub_onix_teste_funcional', 'TEM_SUBOP', 70, 1, null);

    // Arestas Bomba Onix (1.30 + 0.30 + 0.50 + 1.30 + 0.30 = 3.20h)
    insertEdge.run('edge_onix_b1', 'op_gm_onix_troca_bomba_dagua', 'OPERATION', 'sub_onix_desmontar_acesso_frontal', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_onix_b2', 'op_gm_onix_troca_bomba_dagua', 'OPERATION', 'sub_onix_drenar_arrefecimento', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_onix_b3', 'op_gm_onix_troca_bomba_dagua', 'OPERATION', 'sub_onix_trocar_bomba_dagua', 'TEM_SUBOP', 30, 1, null);
    insertEdge.run('edge_onix_b4', 'op_gm_onix_troca_bomba_dagua', 'OPERATION', 'sub_onix_remontar_acesso_frontal', 'TEM_SUBOP', 40, 1, null);
    insertEdge.run('edge_onix_b5', 'op_gm_onix_troca_bomba_dagua', 'OPERATION', 'sub_onix_abastecer_arrefecimento', 'TEM_SUBOP', 50, 1, null);

    // Dependência física de acesso Onix
    insertEdge.run('edge_onix_dep1', 'sub_onix_trocar_correia_tensor', 'SUBOP', 'sub_onix_desmontar_acesso_frontal', 'DEPENDE_ACESSO', 5, 1, null);
    insertEdge.run('edge_onix_dep2', 'sub_onix_trocar_bomba_dagua', 'SUBOP', 'sub_onix_desmontar_acesso_frontal', 'DEPENDE_ACESSO', 5, 1, null);

    // Peças Onix
    insertPart.run('part_onix_1', 'op_gm_onix_troca_correia_banhada', 'Kit de correia dentada banhada a óleo', 'GM-25203737', 1, 'JG', 1, 'Correia banhada a óleo', 'Substituição mandatória');
    insertPart.run('part_onix_2', 'op_gm_onix_troca_correia_banhada', 'Tensor da correia dentada', 'GM-25203738', 1, 'UN', 1, 'Tensor dinâmico', null);
    insertPart.run('part_onix_3', 'op_gm_onix_troca_correia_banhada', 'Junta da tampa frontal de distribuição', 'GM-25203739', 1, 'UN', 1, 'Elastômero de vedação', null);
    insertPart.run('part_onix_4', 'op_gm_onix_troca_correia_banhada', 'Retentor dianteiro do virabrequim', 'GM-25203740', 1, 'UN', 1, 'Retentor PTFE', null);
    insertPart.run('part_onix_5', 'op_gm_onix_troca_correia_banhada', 'Óleo lubrificante Dexos 1 Gen 3 0W20', 'ACDELCO-0W20-D1G3', 4, 'L', 1, 'Dexos 1 Gen 3 0W20 Sintético', 'Mandatório');
    insertPart.run('part_onix_6', 'op_gm_onix_troca_correia_banhada', 'Filtro de óleo lubrificante', 'GM-25206966', 1, 'UN', 1, 'Elemento filtrante', null);
    insertPart.run('part_onix_7', 'op_gm_onix_troca_bomba_dagua', "Bomba d'água do motor", 'GM-25203745', 1, 'UN', 1, 'Bomba mecânica', null);
    insertPart.run('part_onix_8', 'op_gm_onix_troca_bomba_dagua', "Junta da bomba d'água", 'GM-25203746', 1, 'UN', 1, 'Junta vulcanizada', null);
    insertPart.run('part_onix_9', 'op_gm_onix_troca_bomba_dagua', 'Aditivo de arrefecimento Dex-Cool concentrado', 'ACDELCO-DEXCOOL', 3, 'L', 1, 'Norma GM 6277M (Dex-Cool)', 'Diluição 50%');
    insertPart.run('part_onix_10', 'op_gm_onix_troca_bomba_dagua', 'Água desmineralizada', 'AGUA-DESM-1L', 3, 'L', 1, 'Pureza industrial', null);

    // Chunks Onix
    insertChunk.run(
      'chk_onix_correia',
      'op_gm_onix_troca_correia_banhada',
      'gm_onix_plus_2020_2025',
      'gm_css_prime_10_turbo',
      'src_gm_tis_onix_turbo',
      'GM Onix Plus 1.0 Turbo — Substituição da Correia Banhada a Óleo',
      'Procedimento oficial de troca da correia dentada banhada a óleo do Chevrolet Onix Plus 1.0 Turbo CSS Prime. Exige ferramenta de fasagem Raven 131003, trava de volante, substituição mandatória da junta frontal, retentor do virabrequim, 4 litros de óleo 0W20 Dexos 1 Gen 3 e filtro de óleo.',
      JSON.stringify({ marca: 'Chevrolet', modelo: 'Onix Plus', motor: 'CSS Prime 1.0 Turbo', categoria: 'DISTRIBUICAO_MOTOR', tempoHoras: 4.50 })
    );

    insertChunk.run(
      'chk_onix_bomba',
      'op_gm_onix_troca_bomba_dagua',
      'gm_onix_plus_2020_2025',
      'gm_css_prime_10_turbo',
      'src_gm_tis_onix_turbo',
      "GM Onix Plus 1.0 Turbo — Substituição da Bomba d'Água",
      "Procedimento oficial de substituição da bomba d'água do GM Onix Plus 1.0 Turbo. Requer remoção das proteções frontais, drenagem do fluido de arrefecimento, substituição da bomba com junta nova (torque 10 Nm) e abastecimento com aditivo Dex-Cool concentrado.",
      JSON.stringify({ marca: 'Chevrolet', modelo: 'Onix Plus', motor: 'CSS Prime 1.0 Turbo', categoria: 'ARREFECIMENTO', tempoHoras: 3.20 })
    );

    // ==========================================
    // PLATAFORMA 2B: Chevrolet Tracker 1.0/1.2 Turbo (2020-2025)
    // ==========================================
    insertVehicle.run('gm_tracker_2020_2025', 'Chevrolet', 'Tracker', 'G3', 2020, 2025, 'PASSEIO');
    insertEngine.run('gm_css_prime_10_turbo_tracker', 'gm_tracker_2020_2025', 'CSS Prime 1.0 Turbo', '1.0', '1.0 12V Ecotec Turbo Flex', 'FLEX', 'TURBO', 12);
    insertEngine.run('gm_css_prime_12_turbo_tracker', 'gm_tracker_2020_2025', 'CSS Prime 1.2 Turbo', '1.2', '1.2 12V Ecotec Turbo Flex', 'FLEX', 'TURBO', 12);
    insertSource.run(
      'src_gm_tis_tracker_turbo',
      'MANUAL_OEM',
      'HOMOLOGADO_OEM',
      'Manual Oficial GM Chevrolet TIS — Linha Tracker Turbo',
      'Edição 2023',
      'Grupo 44 — Suspensão Dianteira',
      'Seção 44-1 / Operação 441100',
      'ENGENHARIA_TORK'
    );

    // Sub-operações Bieleta GM (Tracker / Onix)
    insertSubOp.run(
      'sub_gm_elevar_remover_rodas_diant',
      '44-1101',
      'Elevação no elevador automotivo e desmontagem das rodas dianteiras',
      'Posicionar sapatas do elevador, suspender o veículo e desapertar porcas de roda 19mm.',
      'DESMONTAGEM',
      0.25,
      JSON.stringify(['Chave de roda 19mm', 'Elevador automotivo']),
      'Porcas de roda',
      1
    );

    insertSubOp.run(
      'sub_gm_substituir_bieletas_diant',
      '44-1102',
      'Desconectar articulações da bieleta com contra-apoio e instalar novas bieletas',
      'Bloquear pino esférico com chave sextavada interna, soltar porcas autotravantes e fixar nova bieleta da barra estabilizadora.',
      'EXECUCAO',
      0.35,
      JSON.stringify(['Chave combinada 18mm', 'Chave Allen/Torx de contra-apoio', 'Torquímetro']),
      '55 Nm nas porcas autotravantes da bieleta',
      0
    );

    insertSubOp.run(
      'sub_gm_remontar_rodas_torque',
      '44-1103',
      'Remontagem das rodas dianteiras e aperto em cruz com torquímetro calibrado',
      'Acoplar rodas no cubo, pré-aperto manual e descida do elevador para torque final.',
      'REMONTAGEM',
      0.20,
      JSON.stringify(['Torquímetro de precisão 1/2', 'Soquete 19mm']),
      '120 Nm aperto cruzado nas rodas',
      1
    );

    // Operação Tracker
    insertOp.run(
      'op_gm_tracker_troca_bieletas_diant',
      'GM-44-1100',
      'gm_tracker_2020_2025',
      'gm_css_prime_10_turbo_tracker',
      'Substituição das Bieletas da Barra Estabilizadora Dianteira',
      'troca bieleta tracker, bieleta dianteira tracker, bieleta barra estabilizadora tracker, troca da bieleta dianteira direita tracker, bieletas tracker',
      'SUSPENSAO',
      0.80,
      1.0,
      'BAIXO',
      'src_gm_tis_tracker_turbo',
      'HOMOLOGADO_OEM'
    );

    // Operação Onix
    insertOp.run(
      'op_gm_onix_troca_bieletas_diant',
      'GM-44-1101',
      'gm_onix_plus_2020_2025',
      'gm_css_prime_10_turbo',
      'Substituição das Bieletas da Barra Estabilizadora Dianteira',
      'troca bieleta onix, bieleta dianteira onix, bieleta barra estabilizadora onix, bieletas onix plus',
      'SUSPENSAO',
      0.80,
      1.0,
      'BAIXO',
      'src_gm_tis_onix_turbo',
      'HOMOLOGADO_OEM'
    );

    // Arestas Bieletas Tracker (0.25 + 0.35 + 0.20 = 0.80h)
    insertEdge.run('edge_tracker_b1', 'op_gm_tracker_troca_bieletas_diant', 'OPERATION', 'sub_gm_elevar_remover_rodas_diant', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_tracker_b2', 'op_gm_tracker_troca_bieletas_diant', 'OPERATION', 'sub_gm_substituir_bieletas_diant', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_tracker_b3', 'op_gm_tracker_troca_bieletas_diant', 'OPERATION', 'sub_gm_remontar_rodas_torque', 'TEM_SUBOP', 30, 1, null);

    // Arestas Bieletas Onix (0.25 + 0.35 + 0.20 = 0.80h)
    insertEdge.run('edge_onix_bieleta_1', 'op_gm_onix_troca_bieletas_diant', 'OPERATION', 'sub_gm_elevar_remover_rodas_diant', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_onix_bieleta_2', 'op_gm_onix_troca_bieletas_diant', 'OPERATION', 'sub_gm_substituir_bieletas_diant', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_onix_bieleta_3', 'op_gm_onix_troca_bieletas_diant', 'OPERATION', 'sub_gm_remontar_rodas_torque', 'TEM_SUBOP', 30, 1, null);

    // Peças Bieletas
    insertPart.run('part_tracker_bieleta_1', 'op_gm_tracker_troca_bieletas_diant', 'Bieleta da barra estabilizadora dianteira', 'GM-26233157', 2, 'UN', 1, 'Pino esférico M12 aço forjado', null);
    insertPart.run('part_tracker_bieleta_2', 'op_gm_tracker_troca_bieletas_diant', 'Porcas autotravantes flangeadas M12', 'GM-11547142', 4, 'UN', 1, 'Porcas autofrenantes classe 10', 'Substituição mandatória');
    insertPart.run('part_onix_bieleta_1', 'op_gm_onix_troca_bieletas_diant', 'Bieleta da barra estabilizadora dianteira', 'GM-26233157', 2, 'UN', 1, 'Pino esférico M12 aço forjado', null);
    insertPart.run('part_onix_bieleta_2', 'op_gm_onix_troca_bieletas_diant', 'Porcas autotravantes flangeadas M12', 'GM-11547142', 4, 'UN', 1, 'Porcas autofrenantes classe 10', 'Substituição mandatória');

    // Chunks FTS5
    insertChunk.run(
      'chk_tracker_bieleta',
      'op_gm_tracker_troca_bieletas_diant',
      'gm_tracker_2020_2025',
      'gm_css_prime_10_turbo_tracker',
      'src_gm_tis_tracker_turbo',
      'Chevrolet Tracker — Substituição das Bieletas da Barra Estabilizadora Dianteira',
      'Procedimento oficial para substituição das bieletas da barra estabilizadora dianteira do Chevrolet Tracker. Exige elevação no elevador automotivo, remoção das rodas dianteiras, desaperto com contra-apoio sextavado para evitar rotação do pino esférico, novas porcas autofrenantes com torque de 55 Nm e reaperto cruzado das rodas com torquímetro a 120 Nm.',
      JSON.stringify({ marca: 'Chevrolet', modelo: 'Tracker', motor: 'CSS Prime Turbo', categoria: 'SUSPENSAO', tempoHoras: 0.80 })
    );

    insertChunk.run(
      'chk_onix_bieleta',
      'op_gm_onix_troca_bieletas_diant',
      'gm_onix_plus_2020_2025',
      'gm_css_prime_10_turbo',
      'src_gm_tis_onix_turbo',
      'Chevrolet Onix Plus — Substituição das Bieletas da Barra Estabilizadora Dianteira',
      'Procedimento oficial para substituição das bieletas da barra estabilizadora dianteira do Chevrolet Onix Plus. Exige elevação no elevador, desaperto com chave combinada e contra-apoio, novas porcas autofrenantes com torque de 55 Nm e torque nas rodas a 120 Nm.',
      JSON.stringify({ marca: 'Chevrolet', modelo: 'Onix Plus', motor: 'CSS Prime 1.0 Turbo', categoria: 'SUSPENSAO', tempoHoras: 0.80 })
    );

    // ==========================================
    // PLATAFORMA 3: Honda Civic G10 2.0 i-VTEC (2017-2021)
    // ==========================================
    insertVehicle.run('honda_civic_g10_2017_2021', 'Honda', 'Civic', 'G10', 2017, 2021, 'PASSEIO');
    insertEngine.run('honda_r20z_20_ivtec', 'honda_civic_g10_2017_2021', 'R20Z1', '2.0', '2.0 16V i-VTEC FlexOne', 'FLEX', 'ASPIRADO', 16);
    insertSource.run(
      'src_honda_esm_civic_g10',
      'MANUAL_OEM',
      'HOMOLOGADO_OEM',
      'Manual Oficial de Serviço Honda ESM — Civic G10 2.0 i-VTEC',
      'Edição 2020',
      'Grupo 22 — Transmissão e Embreagem',
      'Seção 22-A / Operação 221000',
      'ENGENHARIA_TORK'
    );

    insertSubOp.run(
      'sub_civic_desmontar_semieixos_e_cambio',
      '22-1001',
      'Desconectar semieixos, suspender agregados e descer transmissão mecânica',
      'Soltar mangas de eixo, drenar óleo do câmbio e baixar conjunto de transmissão no cavalete.',
      'DESMONTAGEM',
      1.90,
      JSON.stringify(['Cavalete suporte motor/câmbio', 'Chave combinada 14mm/17mm']),
      'Parafusos da caixa de câmbio',
      1
    );

    insertSubOp.run(
      'sub_civic_remover_volante_e_inspecao',
      '22-1002',
      'Desmontar platô, disco e remover volante do motor para inspeção da face de atrito',
      'Soltar fixações do platô, inspecionar cremalheira e remover volante do motor.',
      'DESMONTAGEM',
      0.40,
      JSON.stringify(['Centralizador de embreagem', 'Trava de volante do motor']),
      '108 Nm parafusos do volante com trava química',
      1
    );

    insertSubOp.run(
      'sub_civic_substituir_retentor_flange',
      '11-2501',
      'Remover retentor flangeado antigo e instalar novo retentor traseiro do virabrequim',
      'Sacar retentor de teflon flangeado, limpar assento e instalar flange com retentor novo.',
      'EXECUCAO',
      0.40,
      JSON.stringify(['Instalador de retentor flangeado', 'Torquímetro']),
      '12 Nm parafusos da flange do retentor',
      0
    );

    insertSubOp.run(
      'sub_civic_reinstalar_cambio_e_semieixos',
      '22-1003',
      'Acoplar caixa de câmbio ao bloco, reinstalar semieixos, quadro auxiliar e sangrar atuador',
      'Subir transmissão, alinhar pino guia, reaparafusar ao bloco e sangrar circuito de embreagem.',
      'REMONTAGEM',
      1.90,
      JSON.stringify(['Torquímetro angular', 'Sangrador de embreagem']),
      '64 Nm fixação do câmbio ao bloco',
      1
    );

    insertOp.run(
      'op_honda_civic_troca_embreagem',
      'HONDA-22-1000',
      'honda_civic_g10_2017_2021',
      'honda_r20z_20_ivtec',
      'Substituição do Kit de Embreagem e Atuador Hidráulico',
      'troca embreagem civic, kit embreagem civic g10, plato e disco civic',
      'TRANSMISSAO',
      4.20,
      1.0,
      'MEDIO',
      'src_honda_esm_civic_g10',
      'HOMOLOGADO_OEM'
    );

    insertOp.run(
      'op_honda_civic_troca_retentor_volante',
      'HONDA-11-2500',
      'honda_civic_g10_2017_2021',
      'honda_r20z_20_ivtec',
      'Substituição do Retentor Traseiro do Virabrequim (Volante)',
      'troca retentor volante civic, retentor traseiro virabrequim civic',
      'MOTOR',
      4.60,
      1.0,
      'ALTO',
      'src_honda_esm_civic_g10',
      'HOMOLOGADO_OEM'
    );

    // Arestas Embreagem (1.90 + 0.40 + 1.90 = 4.20h)
    insertEdge.run('edge_civic_e1', 'op_honda_civic_troca_embreagem', 'OPERATION', 'sub_civic_desmontar_semieixos_e_cambio', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_civic_e2', 'op_honda_civic_troca_embreagem', 'OPERATION', 'sub_civic_remover_volante_e_inspecao', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_civic_e3', 'op_honda_civic_troca_embreagem', 'OPERATION', 'sub_civic_reinstalar_cambio_e_semieixos', 'TEM_SUBOP', 30, 1, null);

    // Arestas Retentor (1.90 + 0.40 + 0.40 + 1.90 = 4.60h)
    insertEdge.run('edge_civic_r1', 'op_honda_civic_troca_retentor_volante', 'OPERATION', 'sub_civic_desmontar_semieixos_e_cambio', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_civic_r2', 'op_honda_civic_troca_retentor_volante', 'OPERATION', 'sub_civic_remover_volante_e_inspecao', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_civic_r3', 'op_honda_civic_troca_retentor_volante', 'OPERATION', 'sub_civic_substituir_retentor_flange', 'TEM_SUBOP', 30, 1, null);
    insertEdge.run('edge_civic_r4', 'op_honda_civic_troca_retentor_volante', 'OPERATION', 'sub_civic_reinstalar_cambio_e_semieixos', 'TEM_SUBOP', 40, 1, null);

    // Dep acesso Civic
    insertEdge.run('edge_civic_dep1', 'sub_civic_substituir_retentor_flange', 'SUBOP', 'sub_civic_remover_volante_e_inspecao', 'DEPENDE_ACESSO', 5, 1, null);
    insertEdge.run('edge_civic_dep2', 'sub_civic_remover_volante_e_inspecao', 'SUBOP', 'sub_civic_desmontar_semieixos_e_cambio', 'DEPENDE_ACESSO', 5, 1, null);

    // Peças Civic
    insertPart.run('part_civic_1', 'op_honda_civic_troca_embreagem', 'Platô de embreagem', 'HONDA-22100-RNA-004', 1, 'UN', 1, 'Diâmetro 220mm OEM', null);
    insertPart.run('part_civic_2', 'op_honda_civic_troca_embreagem', 'Disco de embreagem amortecido', 'HONDA-22200-RNA-004', 1, 'UN', 1, '24 estrias', null);
    insertPart.run('part_civic_3', 'op_honda_civic_troca_embreagem', 'Atuador hidráulico concêntrico (CSC)', 'HONDA-22810-RPF-003', 1, 'UN', 1, 'Rolamento hidráulico integrado', null);
    insertPart.run('part_civic_4', 'op_honda_civic_troca_embreagem', 'Fluido de freio e embreagem DOT4', 'HONDA-DOT4-1L', 1, 'L', 1, 'Norma FMVSS 116 DOT4', null);
    insertPart.run('part_civic_5', 'op_honda_civic_troca_retentor_volante', 'Retentor traseiro do virabrequim', 'HONDA-91214-PNA-014', 1, 'UN', 1, 'Retentor flangeado 80x98x10', null);
    insertPart.run('part_civic_6', 'op_honda_civic_troca_retentor_volante', 'Parafusos do volante do motor', 'HONDA-90011-PNA-003', 6, 'UN', 1, 'M12 alto torque elástico', 'Substituição mandatória');
    insertPart.run('part_civic_7', 'op_honda_civic_troca_retentor_volante', 'Trava química de rosca média/alta', 'LOCTITE-242', 1, 'UN', 1, 'Trava anaeróbica', null);

    // Chunks Civic
    insertChunk.run(
      'chk_civic_emb',
      'op_honda_civic_troca_embreagem',
      'honda_civic_g10_2017_2021',
      'honda_r20z_20_ivtec',
      'src_honda_esm_civic_g10',
      'Honda Civic G10 2.0 — Substituição do Kit de Embreagem',
      'Procedimento oficial de troca de embreagem do Honda Civic G10 2.0 i-VTEC. Exige desacoplamento da transmissão, centralização do disco de embreagem, atuador hidráulico novo e sangria completa com fluido DOT4.',
      JSON.stringify({ marca: 'Honda', modelo: 'Civic', motor: 'R20Z1 2.0', categoria: 'TRANSMISSAO', tempoHoras: 4.20 })
    );

    insertChunk.run(
      'chk_civic_ret',
      'op_honda_civic_troca_retentor_volante',
      'honda_civic_g10_2017_2021',
      'honda_r20z_20_ivtec',
      'src_honda_esm_civic_g10',
      'Honda Civic G10 2.0 — Substituição do Retentor Traseiro do Virabrequim',
      'Procedimento oficial de troca do retentor traseiro do volante do motor do Honda Civic G10 2.0. Exige descer a transmissão, remoção do volante do motor, novos parafusos M12 de fixação com trava química e assentamento de flange com retentor PTFE.',
      JSON.stringify({ marca: 'Honda', modelo: 'Civic', motor: 'R20Z1 2.0', categoria: 'MOTOR', tempoHoras: 4.60 })
    );

    // ==========================================
    // PLATAFORMA 4: Toyota Corolla G12 2.0 (2020-2025)
    // ==========================================
    insertVehicle.run('toyota_corolla_g12_2020_2025', 'Toyota', 'Corolla', 'G12', 2020, 2025, 'PASSEIO');
    insertEngine.run('toyota_m20a_20_flex', 'toyota_corolla_g12_2020_2025', 'M20A-FKB', '2.0', '2.0 16V Dynamic Force Flex', 'FLEX', 'ASPIRADO', 16);
    insertSource.run(
      'src_toyota_tis_corolla_g12',
      'MANUAL_OEM',
      'HOMOLOGADO_OEM',
      'Manual de Oficina Toyota TIS — Corolla G12 Dynamic Force',
      'Edição 2022',
      'Grupo 47 — Freios Dianteiros',
      'Seção 47-B / Operação 471100',
      'ENGENHARIA_TORK'
    );

    insertSubOp.run(
      'sub_corolla_remover_rodas_e_cavalete',
      '47-1101',
      'Elevar veículo no elevador automotivo e remover rodas dianteiras',
      'Posicionar veículo nos braços do elevador e retirar as rodas dianteiras com chave 21mm.',
      'DESMONTAGEM',
      0.35,
      JSON.stringify(['Chave de roda 21mm', 'Elevador automotivo']),
      'Porcas de roda',
      1
    );

    insertSubOp.run(
      'sub_corolla_limpeza_e_lubrificacao_guias',
      '47-1102',
      'Limpeza das pinças, lixamento leve e lubrificação cerâmica dos pinos guia',
      'Escovar superfície de contato das pastilhas, aplicar spray desengraxante e pasta cerâmica nos pinos.',
      'EXECUCAO',
      0.10,
      JSON.stringify(['Escova de aço', 'Spray limpa-freios']),
      '32 Nm parafusos guia da pinça',
      1
    );

    insertSubOp.run(
      'sub_corolla_trocar_discos_ventilados',
      '47-2101',
      'Remover cavalete da pinça, retirar disco gasto, limpar face do cubo e instalar novo disco',
      'Desapertar parafusos do cavalete, remover disco antigo, assentar disco ventilado e medir empenamento.',
      'EXECUCAO',
      0.30,
      JSON.stringify(['Chave 17mm', 'Relógio comparador com base magnética']),
      '105 Nm parafusos do cavalete da pinça',
      0
    );

    insertSubOp.run(
      'sub_corolla_reinstalar_rodas_e_torque',
      '47-1103',
      'Reinstalar rodas dianteiras, baixar veículo e aplicar torque final cruzado',
      'Montar rodas dianteiras e aplicar torque especificado nas porcas cônicas com torquímetro.',
      'REMONTAGEM',
      0.35,
      JSON.stringify(['Torquímetro de precisão 1/2']),
      '103 Nm nas porcas de roda',
      1
    );

    insertOp.run(
      'op_toyota_corolla_troca_pastilhas_diant',
      'TOYOTA-47-1100',
      'toyota_corolla_g12_2020_2025',
      'toyota_m20a_20_flex',
      'Substituição das Pastilhas de Freio Dianteiras',
      'troca pastilhas freio corolla, pastilha dianteira corolla, jogo pastilhas corolla',
      'FREIOS',
      0.80,
      1.0,
      'BAIXO',
      'src_toyota_tis_corolla_g12',
      'HOMOLOGADO_OEM'
    );

    insertOp.run(
      'op_toyota_corolla_troca_discos_diant',
      'TOYOTA-47-2100',
      'toyota_corolla_g12_2020_2025',
      'toyota_m20a_20_flex',
      'Substituição dos Discos de Freio Dianteiros Ventilados',
      'troca disco freio corolla, discos ventilados corolla, par de discos corolla',
      'FREIOS',
      1.10,
      1.0,
      'MEDIO',
      'src_toyota_tis_corolla_g12',
      'HOMOLOGADO_OEM'
    );

    // Arestas Pastilhas Corolla (0.35 + 0.10 + 0.35 = 0.80h)
    insertEdge.run('edge_corolla_p1', 'op_toyota_corolla_troca_pastilhas_diant', 'OPERATION', 'sub_corolla_remover_rodas_e_cavalete', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_corolla_p2', 'op_toyota_corolla_troca_pastilhas_diant', 'OPERATION', 'sub_corolla_limpeza_e_lubrificacao_guias', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_corolla_p3', 'op_toyota_corolla_troca_pastilhas_diant', 'OPERATION', 'sub_corolla_reinstalar_rodas_e_torque', 'TEM_SUBOP', 30, 1, null);

    // Arestas Discos Corolla (0.35 + 0.10 + 0.30 + 0.35 = 1.10h)
    insertEdge.run('edge_corolla_d1', 'op_toyota_corolla_troca_discos_diant', 'OPERATION', 'sub_corolla_remover_rodas_e_cavalete', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_corolla_d2', 'op_toyota_corolla_troca_discos_diant', 'OPERATION', 'sub_corolla_limpeza_e_lubrificacao_guias', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_corolla_d3', 'op_toyota_corolla_troca_discos_diant', 'OPERATION', 'sub_corolla_trocar_discos_ventilados', 'TEM_SUBOP', 30, 1, null);
    insertEdge.run('edge_corolla_d4', 'op_toyota_corolla_troca_discos_diant', 'OPERATION', 'sub_corolla_reinstalar_rodas_e_torque', 'TEM_SUBOP', 40, 1, null);

    // Dep acesso Corolla
    insertEdge.run('edge_corolla_dep1', 'sub_corolla_trocar_discos_ventilados', 'SUBOP', 'sub_corolla_remover_rodas_e_cavalete', 'DEPENDE_ACESSO', 5, 1, null);

    // Peças Corolla
    insertPart.run('part_corolla_1', 'op_toyota_corolla_troca_pastilhas_diant', 'Jogo de pastilhas de freio dianteiras com lâminas antirruído', 'TOYOTA-04465-02420', 1, 'JG', 1, 'Composto cerâmico OEM', null);
    insertPart.run('part_corolla_2', 'op_toyota_corolla_troca_pastilhas_diant', 'Spray desengraxante limpa-freios', 'WURTH-LIMPA-FREIOS', 1, 'UN', 1, 'Secagem rápida', null);
    insertPart.run('part_corolla_3', 'op_toyota_corolla_troca_pastilhas_diant', 'Pasta cerâmica lubrificante para guias de pinça', 'TOYOTA-GREASE-PIN', 1, 'UN', 1, 'Resistente a alta temperatura', null);
    insertPart.run('part_corolla_4', 'op_toyota_corolla_troca_discos_diant', 'Par de discos de freio dianteiros ventilados', 'TOYOTA-43512-02350', 1, 'PAR', 1, 'Diâmetro 275mm espessura 25mm', null);
    insertPart.run('part_corolla_5', 'op_toyota_corolla_troca_discos_diant', 'Fluido de freio DOT4 sintetizado', 'TOYOTA-DOT4-1L', 1, 'L', 1, 'Norma FMVSS 116 DOT4', null);

    // Chunks Corolla
    insertChunk.run(
      'chk_corolla_past',
      'op_toyota_corolla_troca_pastilhas_diant',
      'toyota_corolla_g12_2020_2025',
      'toyota_m20a_20_flex',
      'src_toyota_tis_corolla_g12',
      'Toyota Corolla G12 2.0 — Substituição das Pastilhas de Freio',
      'Procedimento oficial de troca das pastilhas de freio dianteiras do Toyota Corolla G12 2.0 Dynamic Force. Inclui limpeza química, lubrificação cerâmica dos pinos deslizantes e torque nas rodas de 103 Nm.',
      JSON.stringify({ marca: 'Toyota', modelo: 'Corolla', motor: 'M20A-FKB 2.0', categoria: 'FREIOS', tempoHoras: 0.80 })
    );

    insertChunk.run(
      'chk_corolla_disc',
      'op_toyota_corolla_troca_discos_diant',
      'toyota_corolla_g12_2020_2025',
      'toyota_m20a_20_flex',
      'src_toyota_tis_corolla_g12',
      'Toyota Corolla G12 2.0 — Substituição dos Discos Ventilados',
      'Procedimento de troca de discos dianteiros ventilados do Toyota Corolla 2.0. Exige remoção do cavalete (torque 105 Nm), limpeza do cubo de roda e medição de empenamento com relógio comparador tolerância máx 0,05mm.',
      JSON.stringify({ marca: 'Toyota', modelo: 'Corolla', motor: 'M20A-FKB 2.0', categoria: 'FREIOS', tempoHoras: 1.10 })
    );

    // ==========================================
    // PLATAFORMA 5: Jeep Renegade T270 1.3 Turbo (2022-2025)
    // ==========================================
    insertVehicle.run('jeep_renegade_t270_2022_2025', 'Jeep', 'Renegade', 'T270', 2022, 2025, 'SUV');
    insertEngine.run('jeep_gse_t270_13_turbo', 'jeep_renegade_t270_2022_2025', 'GSE T270', '1.3', '1.3 16V GSE Turbo Flex 185cv', 'FLEX', 'TURBO', 16);
    insertSource.run(
      'src_stellantis_jeep_renegade_t270',
      'MANUAL_OEM',
      'HOMOLOGADO_OEM',
      'Manual de Reparação Stellantis — Jeep Renegade T270',
      'Edição 2023',
      'Grupo 44 — Suspensão Dianteira',
      'Seção 44-A / Operação 441000',
      'ENGENHARIA_TORK'
    );

    insertSubOp.run(
      'sub_renegade_desmontar_colunas_suspensao',
      '44-1001',
      'Desconectar bieletas, flexíveis e remover conjunto coluna da manga de eixo',
      'Soltar terminal da barra estabilizadora, suporte do chicote ABS e parafusos de fixação da manga de eixo.',
      'DESMONTAGEM',
      0.90,
      JSON.stringify(['Chave combinada 18mm', 'Chave Allen 6mm']),
      'Parafusos da manga de eixo',
      1
    );

    insertSubOp.run(
      'sub_renegade_encolher_molas_desmontar_haste',
      '44-1002',
      'Fixar no encolhedor de molas, comprimir e desmontar prato superior da haste',
      'Comprimir mola helicoidal com encolhedor seguro e desapertar porca central da haste do amortecedor.',
      'DESMONTAGEM',
      0.20,
      JSON.stringify(['Encolhedor hidráulico de molas', 'Soquete especial de amortecedor 21mm']),
      'Porca da haste do amortecedor',
      1
    );

    insertSubOp.run(
      'sub_renegade_substituir_par_amortecedores',
      '44-1003',
      'Substituir tubos de amortecedores dianteiros pressurizados a gás e escorvar',
      'Descartar amortecedores gastos, escorvar novas peças e montar batentes/coifas na haste.',
      'EXECUCAO',
      0.20,
      JSON.stringify(['Chave 21mm']),
      'Fixação da haste',
      0
    );

    insertSubOp.run(
      'sub_renegade_remontar_colunas_suspensao',
      '44-1004',
      'Reinstalar colunas na manga de eixo, acoplar bieletas e aplicar torque final',
      'Alinhar coluna nos furos da torre superior, apertar parafusos da manga de eixo e reconectar bieletas.',
      'REMONTAGEM',
      0.90,
      JSON.stringify(['Torquímetro 1/2', 'Chave 18mm']),
      '75 Nm fixação superior e 90 Nm na manga de eixo',
      1
    );

    insertOp.run(
      'op_jeep_renegade_troca_amortecedores_diant',
      'JEEP-44-1000',
      'jeep_renegade_t270_2022_2025',
      'jeep_gse_t270_13_turbo',
      'Substituição do Par de Amortecedores Dianteiros',
      'troca amortecedor renegade, amortecedor dianteiro renegade t270, suspensao dianteira renegade',
      'SUSPENSAO',
      2.20,
      1.0,
      'MEDIO',
      'src_stellantis_jeep_renegade_t270',
      'HOMOLOGADO_OEM'
    );

    insertOp.run(
      'op_jeep_renegade_troca_coxins_batentes_diant',
      'JEEP-44-2000',
      'jeep_renegade_t270_2022_2025',
      'jeep_gse_t270_13_turbo',
      'Substituição dos Coxins Superiores e Batentes Dianteiros',
      'troca coxim amortecedor renegade, batente suspensao renegade, coifa amortecedor renegade',
      'SUSPENSAO',
      2.00,
      1.0,
      'MEDIO',
      'src_stellantis_jeep_renegade_t270',
      'HOMOLOGADO_OEM'
    );

    // Arestas Amortecedores Renegade (0.90 + 0.20 + 0.20 + 0.90 = 2.20h)
    insertEdge.run('edge_renegade_a1', 'op_jeep_renegade_troca_amortecedores_diant', 'OPERATION', 'sub_renegade_desmontar_colunas_suspensao', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_renegade_a2', 'op_jeep_renegade_troca_amortecedores_diant', 'OPERATION', 'sub_renegade_encolher_molas_desmontar_haste', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_renegade_a3', 'op_jeep_renegade_troca_amortecedores_diant', 'OPERATION', 'sub_renegade_substituir_par_amortecedores', 'TEM_SUBOP', 30, 1, null);
    insertEdge.run('edge_renegade_a4', 'op_jeep_renegade_troca_amortecedores_diant', 'OPERATION', 'sub_renegade_remontar_colunas_suspensao', 'TEM_SUBOP', 40, 1, null);

    // Arestas Coxins Renegade (0.90 + 0.20 + 0.90 = 2.00h)
    insertEdge.run('edge_renegade_c1', 'op_jeep_renegade_troca_coxins_batentes_diant', 'OPERATION', 'sub_renegade_desmontar_colunas_suspensao', 'TEM_SUBOP', 10, 1, null);
    insertEdge.run('edge_renegade_c2', 'op_jeep_renegade_troca_coxins_batentes_diant', 'OPERATION', 'sub_renegade_encolher_molas_desmontar_haste', 'TEM_SUBOP', 20, 1, null);
    insertEdge.run('edge_renegade_c3', 'op_jeep_renegade_troca_coxins_batentes_diant', 'OPERATION', 'sub_renegade_remontar_colunas_suspensao', 'TEM_SUBOP', 30, 1, null);

    // Dep acesso Renegade
    insertEdge.run('edge_renegade_dep1', 'sub_renegade_substituir_par_amortecedores', 'SUBOP', 'sub_renegade_encolher_molas_desmontar_haste', 'DEPENDE_ACESSO', 5, 1, null);
    insertEdge.run('edge_renegade_dep2', 'sub_renegade_encolher_molas_desmontar_haste', 'SUBOP', 'sub_renegade_desmontar_colunas_suspensao', 'DEPENDE_ACESSO', 5, 1, null);

    // Peças Renegade
    insertPart.run('part_renegade_1', 'op_jeep_renegade_troca_amortecedores_diant', 'Par de amortecedores dianteiros pressurizados a gás', 'JEEP-52074311', 1, 'PAR', 1, 'Amortecedor bi-tubo pressurizado', null);
    insertPart.run('part_renegade_2', 'op_jeep_renegade_troca_coxins_batentes_diant', 'Kit de coxins superiores com rolamento de peso', 'JEEP-52074320', 1, 'PAR', 1, 'Rolamento axial reforçado', null);
    insertPart.run('part_renegade_3', 'op_jeep_renegade_troca_coxins_batentes_diant', 'Batentes de poliuretano e coifas guarda-pó', 'JEEP-52074325', 1, 'PAR', 1, 'Proteção da haste', null);

    // Chunks Renegade
    insertChunk.run(
      'chk_renegade_amort',
      'op_jeep_renegade_troca_amortecedores_diant',
      'jeep_renegade_t270_2022_2025',
      'jeep_gse_t270_13_turbo',
      'src_stellantis_jeep_renegade_t270',
      'Jeep Renegade T270 1.3 Turbo — Substituição dos Amortecedores Dianteiros',
      'Procedimento oficial de troca dos amortecedores dianteiros do Jeep Renegade T270 1.3 Turbo. Exige encolhedor de molas, soquete de 21mm para haste, reaperto da manga de eixo a 90 Nm e alinhamento de direção.',
      JSON.stringify({ marca: 'Jeep', modelo: 'Renegade', motor: 'GSE T270 1.3', categoria: 'SUSPENSAO', tempoHoras: 2.20 })
    );

    insertChunk.run(
      'chk_renegade_coxim',
      'op_jeep_renegade_troca_coxins_batentes_diant',
      'jeep_renegade_t270_2022_2025',
      'jeep_gse_t270_13_turbo',
      'src_stellantis_jeep_renegade_t270',
      'Jeep Renegade T270 1.3 Turbo — Substituição de Coxins e Batentes',
      'Procedimento de troca dos coxins superiores com rolamento de peso e batentes da suspensão dianteira do Jeep Renegade T270. Exige desmontagem das colunas e aperto com torquímetro a 75 Nm nos coxins.',
      JSON.stringify({ marca: 'Jeep', modelo: 'Renegade', motor: 'GSE T270 1.3', categoria: 'SUSPENSAO', tempoHoras: 2.00 })
    );

    // ==========================================
    // SUB-OPERAÇÕES E OPERAÇÕES CANÔNICAS: MOTOR DE PARTIDA (ARRANQUE)
    // ==========================================
    insertSubOp.run(
      'sub_oem_desconectar_bateria_seguranca',
      '27-1001',
      'Desconexão do cabo massa negativo da bateria e isolamento de segurança elétrica',
      'Desenergizar a rede de bordo soltando a porca 10mm do polo negativo da bateria antes de intervir na linha B+ direta do motor de partida.',
      'DESMONTAGEM',
      0.15,
      JSON.stringify(['Chave combinada ou catraca 10mm', 'Protetor isolante de polo de bateria']),
      '6 Nm no grampo do terminal negativo',
      1
    );

    insertSubOp.run(
      'sub_oem_acesso_inferior_chicote_arranque',
      '27-1002',
      'Elevação do veículo, remoção do protetor inferior e desconexão do borne B+ e linha 50 do solenoide',
      'Elevar o veículo, remover defletor inferior do cárter, retirar capa isolante do automático, soltar porca M8 do cabo positivo principal (borne 30/B+) e destravar conector do sinal de partida (borne 50).',
      'DESMONTAGEM',
      0.30,
      JSON.stringify(['Elevador automotivo', 'Soquete 13mm com extensão', 'Chave Torx T25 / soquete 10mm para protetor']),
      '10 Nm na porca M8 do borne B+ do solenoide',
      1
    );

    insertSubOp.run(
      'sub_oem_substituir_motor_partida_carcaca',
      '27-1003',
      'Desacoplamento na carcaça da transmissão e instalação do novo motor de partida',
      'Remover os parafusos flangeados superior e inferior de fixação à caixa seca de transmissão, substituir o motor de partida limpando a face de assentamento e aplicar torque especificado.',
      'EXECUCAO',
      0.45,
      JSON.stringify(['Chave catraca 1/2 com extensão articulada', 'Soquetes 13mm e 15mm', 'Torquímetro calibrado 1/2']),
      '35 Nm nos parafusos flangeados de fixação do motor de partida',
      0
    );

    insertSubOp.run(
      'sub_oem_teste_partida_queda_tensao',
      '27-1004',
      'Reconexão da bateria, remontagem do protetor inferior e teste de partida / queda de tensão',
      'Reconectar bateria, acionar partida conferindo acoplamento do bendix na cremalheira, aferir queda de tensão na partida (< 0,5V no cabo positivo) e reinstalar protetor inferior.',
      'TESTE_AJUSTE',
      0.20,
      JSON.stringify(['Multímetro digital automotivo', 'Alicate amperímetro indutivo', 'Chave 10mm']),
      'Fixadores do protetor inferior: 8 Nm',
      0
    );

    const starterMotorPlatforms = [
      {
        opId: 'op_gm_tracker_troca_motor_partida',
        code: 'GM-27-1200',
        vehId: 'gm_tracker_2020_2025',
        engId: 'gm_css_prime_10_turbo_tracker',
        srcId: 'src_gm_tis_tracker_turbo',
        label: 'Chevrolet Tracker',
        synonyms: 'troca de motor de partida tracker, motor de partida tracker, motor de arranque tracker, trocar arranque tracker'
      },
      {
        opId: 'op_gm_onix_troca_motor_partida',
        code: 'GM-27-1201',
        vehId: 'gm_onix_plus_2020_2025',
        engId: 'gm_css_prime_10_turbo',
        srcId: 'src_gm_tis_onix_turbo',
        label: 'Chevrolet Onix Plus',
        synonyms: 'troca de motor de partida onix, motor de partida onix, motor de arranque onix, trocar arranque onix'
      },
      {
        opId: 'op_vw_golf_troca_motor_partida',
        code: 'VW-27-1200',
        vehId: 'vw_golf_mk7_2014_2021',
        engId: 'vw_ea211_14_tsi',
        srcId: 'src_vw_elsapro_golf_mk7_gr19',
        label: 'Volkswagen Golf MK7',
        synonyms: 'troca de motor de partida golf, motor de partida golf, motor de arranque golf, trocar arranque golf'
      }
    ];

    for (const sp of starterMotorPlatforms) {
      insertOp.run(
        sp.opId,
        sp.code,
        sp.vehId,
        sp.engId,
        'Substituição do Motor de Partida (Arranque)',
        sp.synonyms,
        'ELETRICA_PARTIDA',
        1.10,
        1.0,
        'MEDIO',
        sp.srcId,
        'HOMOLOGADO_OEM'
      );

      insertEdge.run(`edge_${sp.opId}_1`, sp.opId, 'OPERATION', 'sub_oem_desconectar_bateria_seguranca', 'TEM_SUBOP', 10, 1, null);
      insertEdge.run(`edge_${sp.opId}_2`, sp.opId, 'OPERATION', 'sub_oem_acesso_inferior_chicote_arranque', 'TEM_SUBOP', 20, 1, null);
      insertEdge.run(`edge_${sp.opId}_3`, sp.opId, 'OPERATION', 'sub_oem_substituir_motor_partida_carcaca', 'TEM_SUBOP', 30, 1, null);
      insertEdge.run(`edge_${sp.opId}_4`, sp.opId, 'OPERATION', 'sub_oem_teste_partida_queda_tensao', 'TEM_SUBOP', 40, 1, null);

      insertPart.run(`part_${sp.opId}_1`, sp.opId, 'Motor de partida / arranque 12V completo', `${sp.code}-OEM`, 1, 'UN', 1, 'Conjunto com solenoide e impulsor bendix', null);
      insertPart.run(`part_${sp.opId}_2`, sp.opId, 'Porca flangeada M8 cobreada do terminal B+', `${sp.code}-NUT`, 1, 'UN', 0, 'Alta condutividade elétrica', 'Substituir se houver oxidação');

      insertChunk.run(
        `chk_${sp.opId}`,
        sp.opId,
        sp.vehId,
        sp.engId,
        sp.srcId,
        `${sp.label} — Substituição do Motor de Partida (Arranque)`,
        `Procedimento técnico oficial para substituição do motor de partida (arranque) do ${sp.label}. Tempo tabelado de 1,10h (66 minutos). Inclui desconexão da bateria, acesso ao borne B+ (10 Nm) e linha 50, fixação na carcaça da transmissão com torque de 35 Nm e teste de queda de tensão na partida.`,
        JSON.stringify({ modelo: sp.label, categoria: 'ELETRICA_PARTIDA', tempoHoras: 1.10 })
      );
    }

    // Sincroniza tabela FTS5
    db.prepare('DELETE FROM tempario_fts').run();
    db.prepare(`
      INSERT INTO tempario_fts (chunk_id, operation_id, titulo_contexto, conteudo_texto)
      SELECT chunk_id, operation_id, titulo_contexto, conteudo_texto FROM tempario_procedure_chunks
    `).run();
  });

  tx();
}

/**
 * Interface interna da linha retornada pela query CTE.
 */
interface RawCteStepRow {
  ordem_execucao_final: number;
  subop_id: string;
  codigo_etapa: string;
  titulo: string;
  descricao_tecnica: string;
  fase_execucao: string;
  tempo_horas: number;
  tempo_minutos: number;
  ferramentas_json: string;
  torque_especificado: string | null;
  is_acesso_compartilhado: number;
  qtd_servicos_compartilhando: number;
  operacoes_origem_csv: string;
  tempo_liquido_total_horas: number;
  tempo_bruto_total_horas: number;
  tempo_economizado_deduplicacao_horas: number;
}

/**
 * Resolve a cadeia ordenada de execução e calcula a deduplicação matemática
 * de sub-operações compartilhadas (DEPENDE_ACESSO) via Recursive CTE.
 */
export function resolveDeduplicatedServiceChain(
  db: Database.Database,
  operationIds: readonly string[],
  engineId?: string
): DeduplicatedGraphChainResult {
  if (!operationIds || operationIds.length === 0) {
    return {
      steps: [],
      pecasNecessarias: [],
      ferramentasNecessarias: [],
      torquesEspecificados: [],
      tempoLiquidoTotalHoras: 0,
      tempoLiquidoTotalMinutos: 0,
      tempoBrutoTotalHoras: 0,
      tempoEconomizadoDeduplicacaoHoras: 0,
      tempoEconomizadoDeduplicacaoMinutos: 0,
      possuiDeduplicacaoAtiva: false,
      taxaHorariaPadrao: DEFAULT_HOURLY_RATE,
      valorMaoDeObraSugerido: 0,
      valorMaoDeObraBrutoSemAssociativa: 0,
      economiaMaoDeObraReais: 0
    };
  }

  const operationIdsJson = JSON.stringify(operationIds);

  const query = `
    WITH RECURSIVE graph_traversal AS (
      -- Âncora: Sub-operações diretas das operações solicitadas
      SELECT
        e.from_node_id AS root_operation_id,
        e.to_subop_id AS subop_id,
        e.relation_type,
        e.ordem_local,
        1 AS profundidade,
        '|' || e.to_subop_id || '|' AS path_visited
      FROM tempario_dependencies_edges e
      WHERE e.from_node_type = 'OPERATION'
        AND e.from_node_id IN (SELECT value FROM json_each(:operationIdsJson))
        AND (e.condicao_motor_id IS NULL OR :engineId IS NULL OR e.condicao_motor_id = :engineId)

      UNION ALL

      -- Passo Recursivo: Pré-requisitos físicos encadeados
      SELECT
        gt.root_operation_id,
        e2.to_subop_id AS subop_id,
        e2.relation_type,
        e2.ordem_local,
        gt.profundidade + 1 AS profundidade,
        gt.path_visited || e2.to_subop_id || '|' AS path_visited
      FROM graph_traversal gt
      INNER JOIN tempario_dependencies_edges e2
        ON e2.from_node_type = 'SUBOP'
       AND e2.from_node_id = gt.subop_id
      WHERE gt.profundidade < 12
        AND instr(gt.path_visited, '|' || e2.to_subop_id || '|') = 0
        AND (e2.condicao_motor_id IS NULL OR :engineId IS NULL OR e2.condicao_motor_id = :engineId)
    ),
    raw_occurrences AS (
      SELECT
        gt.root_operation_id,
        s.subop_id,
        s.codigo_etapa,
        s.titulo,
        s.descricao_tecnica,
        s.fase_execucao,
        s.tempo_horas,
        s.ferramentas_json,
        s.torque_especificado,
        s.is_acesso_compartilhado,
        MIN(gt.ordem_local) AS menor_ordem_local,
        MAX(gt.profundidade) AS maior_profundidade
      FROM graph_traversal gt
      INNER JOIN tempario_suboperations s ON s.subop_id = gt.subop_id
      GROUP BY gt.root_operation_id, s.subop_id
    ),
    gross_totals AS (
      SELECT COALESCE(SUM(tempo_horas), 0.0) AS tempo_bruto_sem_deduplicacao
      FROM raw_occurrences
    ),
    deduplicated_chain AS (
      SELECT
        ro.subop_id,
        ro.codigo_etapa,
        ro.titulo,
        ro.descricao_tecnica,
        ro.fase_execucao,
        ro.tempo_horas,
        ro.ferramentas_json,
        ro.torque_especificado,
        ro.is_acesso_compartilhado,
        COUNT(DISTINCT ro.root_operation_id) AS qtd_servicos_compartilhando,
        GROUP_CONCAT(DISTINCT ro.root_operation_id) AS operacoes_origem_csv,
        CASE ro.fase_execucao
          WHEN 'DESMONTAGEM' THEN 1
          WHEN 'EXECUCAO'    THEN 2
          WHEN 'REMONTAGEM'  THEN 3
          WHEN 'TESTE_AJUSTE' THEN 4
          ELSE 5
        END AS ordem_fase,
        CASE
          WHEN ro.fase_execucao = 'DESMONTAGEM' THEN -MAX(ro.maior_profundidade)
          ELSE MIN(ro.maior_profundidade)
        END AS criterio_profundidade,
        MIN(ro.menor_ordem_local) AS criterio_ordem_local
      FROM raw_occurrences ro
      GROUP BY ro.subop_id
    )
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY dc.ordem_fase ASC, dc.criterio_profundidade ASC, dc.criterio_ordem_local ASC, dc.subop_id ASC
      ) AS ordem_execucao_final,
      dc.subop_id,
      dc.codigo_etapa,
      dc.titulo,
      dc.descricao_tecnica,
      dc.fase_execucao,
      ROUND(dc.tempo_horas, 2) AS tempo_horas,
      CAST(ROUND(dc.tempo_horas * 60) AS INTEGER) AS tempo_minutos,
      dc.ferramentas_json,
      dc.torque_especificado,
      dc.is_acesso_compartilhado,
      dc.qtd_servicos_compartilhando,
      dc.operacoes_origem_csv,
      ROUND((SELECT SUM(tempo_horas) FROM deduplicated_chain), 2) AS tempo_liquido_total_horas,
      ROUND((SELECT tempo_bruto_sem_deduplicacao FROM gross_totals), 2) AS tempo_bruto_total_horas,
      ROUND(
        (SELECT tempo_bruto_sem_deduplicacao FROM gross_totals) - (SELECT SUM(tempo_horas) FROM deduplicated_chain),
        2
      ) AS tempo_economizado_deduplicacao_horas
    FROM deduplicated_chain dc
    ORDER BY ordem_execucao_final ASC;
  `;

  const rows = db.prepare(query).all({
    operationIdsJson,
    engineId: engineId || null
  }) as RawCteStepRow[];

  if (!rows || rows.length === 0) {
    return {
      steps: [],
      pecasNecessarias: [],
      ferramentasNecessarias: [],
      torquesEspecificados: [],
      tempoLiquidoTotalHoras: 0,
      tempoLiquidoTotalMinutos: 0,
      tempoBrutoTotalHoras: 0,
      tempoEconomizadoDeduplicacaoHoras: 0,
      tempoEconomizadoDeduplicacaoMinutos: 0,
      possuiDeduplicacaoAtiva: false,
      taxaHorariaPadrao: DEFAULT_HOURLY_RATE,
      valorMaoDeObraSugerido: 0,
      valorMaoDeObraBrutoSemAssociativa: 0,
      economiaMaoDeObraReais: 0
    };
  }

  const steps: TemparioSubOperationStep[] = rows.map(r => {
    let ferramentas: string[] = [];
    try {
      ferramentas = JSON.parse(r.ferramentas_json);
    } catch {
      ferramentas = [];
    }

    const operacoesOrigem = (r.operacoes_origem_csv || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);

    return {
      ordemExecucaoFinal: Number(r.ordem_execucao_final),
      subopId: String(r.subop_id),
      codigoEtapa: String(r.codigo_etapa),
      titulo: String(r.titulo),
      descricaoTecnica: String(r.descricao_tecnica),
      faseExecucao: r.fase_execucao as ExecutionPhase,
      tempoHoras: Number(r.tempo_horas),
      tempoMinutos: Number(r.tempo_minutos),
      ferramentas,
      torqueEspecificado: r.torque_especificado || undefined,
      isAcessoCompartilhado: Number(r.is_acesso_compartilhado) === 1,
      qtdServicosCompartilhando: Number(r.qtd_servicos_compartilhando),
      operacoesOrigemIds: operacoesOrigem
    };
  });

  const firstRow = rows[0];
  const tempoLiquidoHoras = Number(firstRow.tempo_liquido_total_horas) || 0;
  const tempoBrutoHoras = Number(firstRow.tempo_bruto_total_horas) || 0;
  const tempoEconomizadoHoras = Math.max(0, Number(firstRow.tempo_economizado_deduplicacao_horas) || 0);

  // Consulta associativa de peças e insumos
  const partsQuery = `
    SELECT
      part_item_id AS partItemId,
      operation_id AS operationId,
      nome_peca AS nomePeca,
      codigo_referencia AS codigoReferencia,
      quantidade,
      unidade,
      obrigatoria,
      especificacao_tecnica AS especificacaoTecnica,
      observacao
    FROM tempario_operation_parts
    WHERE operation_id IN (SELECT value FROM json_each(:operationIdsJson))
    ORDER BY obrigatoria DESC, nome_peca ASC
  `;

  interface RawPartRow {
    partItemId: string;
    operationId: string;
    nomePeca: string;
    codigoReferencia: string | null;
    quantidade: number;
    unidade: string;
    obrigatoria: number;
    especificacaoTecnica: string | null;
    observacao: string | null;
  }

  const rawParts = db.prepare(partsQuery).all({ operationIdsJson }) as RawPartRow[];

  // Agrega peças sem duplicação de mesmo item/especificação
  const pecasMap = new Map<string, TemparioPartItem>();
  for (const p of rawParts) {
    const key = `${p.nomePeca.trim().toLowerCase()}_${(p.especificacaoTecnica || '').trim().toLowerCase()}`;
    const existing = pecasMap.get(key);
    if (existing) {
      pecasMap.set(key, {
        ...existing,
        quantidade: existing.quantidade + Number(p.quantidade),
        obrigatoria: existing.obrigatoria || Number(p.obrigatoria) === 1
      });
    } else {
      pecasMap.set(key, {
        partItemId: p.partItemId,
        operationId: p.operationId,
        nomePeca: p.nomePeca,
        codigoReferencia: p.codigoReferencia || undefined,
        quantidade: Number(p.quantidade),
        unidade: p.unidade,
        obrigatoria: Number(p.obrigatoria) === 1,
        especificacaoTecnica: p.especificacaoTecnica || undefined,
        observacao: p.observacao || undefined
      });
    }
  }
  const pecasNecessarias = Array.from(pecasMap.values());

  // Deduplicação de ferramentas exigidas na bancada
  const allTools = new Set<string>();
  for (const step of steps) {
    for (const tool of step.ferramentas) {
      if (tool && tool.trim()) {
        allTools.add(tool.trim());
      }
    }
  }
  const ferramentasNecessarias = Array.from(allTools);

  // Consolidação de torques especificados
  const allTorques = new Set<string>();
  for (const step of steps) {
    if (step.torqueEspecificado && step.torqueEspecificado.trim()) {
      allTorques.add(step.torqueEspecificado.trim());
    }
  }
  const torquesEspecificados = Array.from(allTorques);

  // Precificação comercial com taxa fixa R$ 270,00/h
  const taxaHorariaPadrao = DEFAULT_HOURLY_RATE;
  const valorMaoDeObraSugerido = Math.round(tempoLiquidoHoras * taxaHorariaPadrao * 100) / 100;
  const valorMaoDeObraBrutoSemAssociativa = Math.round(tempoBrutoHoras * taxaHorariaPadrao * 100) / 100;
  const economiaMaoDeObraReais = Math.round(tempoEconomizadoHoras * taxaHorariaPadrao * 100) / 100;

  return {
    steps,
    pecasNecessarias,
    ferramentasNecessarias,
    torquesEspecificados,
    tempoLiquidoTotalHoras: tempoLiquidoHoras,
    tempoLiquidoTotalMinutos: Math.round(tempoLiquidoHoras * 60),
    tempoBrutoTotalHoras: tempoBrutoHoras,
    tempoEconomizadoDeduplicacaoHoras: tempoEconomizadoHoras,
    tempoEconomizadoDeduplicacaoMinutos: Math.round(tempoEconomizadoHoras * 60),
    possuiDeduplicacaoAtiva: tempoEconomizadoHoras > 0.001,
    taxaHorariaPadrao,
    valorMaoDeObraSugerido,
    valorMaoDeObraBrutoSemAssociativa,
    economiaMaoDeObraReais
  };
}

/**
 * Consulta operações cadastradas por IDs.
 */
export function getTemparioOperationsByIds(
  db: Database.Database,
  operationIds: readonly string[]
): TemparioOperationRecord[] {
  if (!operationIds || operationIds.length === 0) return [];
  const placeholders = operationIds.map(() => '?').join(',');
  const query = `
    SELECT operation_id, codigo_operacao_oem, vehicle_id, engine_id,
           titulo, categoria_servico, tempo_padrao_bruto_horas,
           fator_variacao_motor, grau_dificuldade, source_id, status_evidencia
    FROM tempario_operations
    WHERE operation_id IN (${placeholders})
  `;

  const rows = db.prepare(query).all(...operationIds) as Array<{
    operation_id: string;
    codigo_operacao_oem: string;
    vehicle_id: string;
    engine_id?: string | null;
    titulo: string;
    categoria_servico: string;
    tempo_padrao_bruto_horas: number;
    fator_variacao_motor: number;
    grau_dificuldade: string;
    source_id: string;
    status_evidencia: string;
  }>;

  return rows.map(r => ({
    operationId: r.operation_id,
    codigoOperacaoOem: r.codigo_operacao_oem,
    vehicleId: r.vehicle_id,
    engineId: r.engine_id || undefined,
    titulo: r.titulo,
    categoriaServico: r.categoria_servico,
    tempoPadraoBrutoHoras: Number(r.tempo_padrao_bruto_horas),
    fatorVariacaoMotor: Number(r.fator_variacao_motor) || 1.0,
    grauDificuldade: r.grau_dificuldade as TemparioDifficulty,
    sourceId: r.source_id,
    statusEvidencia: r.status_evidencia as TemparioEvidenceStatus
  }));
}

/**
 * Localiza veículos por busca flexível de marca e modelo.
 * Bloqueia sumariamente buscas por placeholders genéricos ("Veículo", "Veículo Passeio", "Nacional").
 */
export function findTemparioVehicles(
  db: Database.Database,
  params: { marca?: string; modelo?: string; ano?: number }
): TemparioVehicleRecord[] {
  const cleanMarca = params.marca?.trim();
  const cleanModelo = params.modelo?.trim();

  if (!cleanMarca && (!cleanModelo || !isValidVehicleForPersistence(undefined, cleanModelo))) {
    return [];
  }

  let sql = 'SELECT vehicle_id, marca, modelo, geracao, ano_inicio, ano_fim, categoria FROM tempario_vehicles WHERE 1=1';
  const queryParams: Array<string | number> = [];

  if (cleanMarca && isValidVehicleForPersistence(cleanMarca, 'ModeloValido')) {
    sql += ' AND LOWER(marca) LIKE ?';
    queryParams.push(`%${cleanMarca.toLowerCase()}%`);
  }
  if (cleanModelo && isValidVehicleForPersistence(undefined, cleanModelo)) {
    sql += ' AND LOWER(modelo) LIKE ?';
    queryParams.push(`%${cleanModelo.toLowerCase()}%`);
  }
  if (params.ano) {
    sql += ' AND ano_inicio <= ? AND ano_fim >= ?';
    queryParams.push(params.ano, params.ano);
  }

  sql += ' ORDER BY ano_inicio DESC LIMIT 10';

  const rows = db.prepare(sql).all(...queryParams) as Array<{
    vehicle_id: string;
    marca: string;
    modelo: string;
    geracao?: string | null;
    ano_inicio: number;
    ano_fim: number;
    categoria: string;
  }>;

  return rows
    .filter(r => isValidVehicleForPersistence(r.marca, r.modelo))
    .map(r => ({
      vehicleId: r.vehicle_id,
      marca: r.marca,
      modelo: r.modelo,
      geracao: r.geracao || undefined,
      anoInicio: Number(r.ano_inicio),
      anoFim: Number(r.ano_fim),
      categoria: r.categoria as 'PASSEIO' | 'SUV' | 'UTILITARIO' | 'PREMIUM'
    }));
}

interface RawEngineDbRow {
  engine_id: string;
  vehicle_id: string;
  codigo_motor: string;
  cilindrada: string;
  descricao_comercial: string;
  combustivel: 'FLEX' | 'GASOLINA' | 'DIESEL' | 'HIBRIDO' | 'ELETRICO';
  aspiracao: 'ASPIRADO' | 'TURBO' | 'BITURBO' | 'SUPERCHARGED';
  valvulas: number;
}

/**
 * Localiza motor por código ou descrição para determinado veículo.
 */
export function findTemparioEngine(
  db: Database.Database,
  vehicleId: string,
  engineText?: string
): TemparioEngineRecord | null {
  if (!engineText) {
    const row = db.prepare(`
      SELECT engine_id, vehicle_id, codigo_motor, cilindrada, descricao_comercial, combustivel, aspiracao, valvulas
      FROM tempario_engines
      WHERE vehicle_id = ?
      LIMIT 1
    `).get(vehicleId) as RawEngineDbRow | undefined;
    if (!row) return null;
    return {
      engineId: row.engine_id,
      vehicleId: row.vehicle_id,
      codigoMotor: row.codigo_motor,
      cilindrada: row.cilindrada,
      descricaoComercial: row.descricao_comercial,
      combustivel: row.combustivel,
      aspiracao: row.aspiracao,
      valvulas: Number(row.valvulas)
    };
  }

  const clean = `%${engineText.trim().toLowerCase()}%`;
  const row = db.prepare(`
    SELECT engine_id, vehicle_id, codigo_motor, cilindrada, descricao_comercial, combustivel, aspiracao, valvulas
    FROM tempario_engines
    WHERE vehicle_id = ?
      AND (LOWER(codigo_motor) LIKE ? OR LOWER(descricao_comercial) LIKE ? OR LOWER(cilindrada) LIKE ?)
    LIMIT 1
  `).get(vehicleId, clean, clean, clean) as RawEngineDbRow | undefined;

  if (!row) return null;
  return {
    engineId: row.engine_id,
    vehicleId: row.vehicle_id,
    codigoMotor: row.codigo_motor,
    cilindrada: row.cilindrada,
    descricaoComercial: row.descricao_comercial,
    combustivel: row.combustivel,
    aspiracao: row.aspiracao,
    valvulas: Number(row.valvulas)
  };
}

/**
 * Consulta fontes de evidência técnica por IDs.
 */
export function getTemparioEvidenceSources(
  db: Database.Database,
  sourceIds: readonly string[]
): TemparioEvidenceSourceRecord[] {
  if (!sourceIds || sourceIds.length === 0) return [];
  const placeholders = sourceIds.map(() => '?').join(',');
  const query = `
    SELECT source_id, tipo_fonte, status_evidencia, nome_documento,
           versao_revisao, capitulo_secao, pagina_tabela, homologado_por
    FROM tempario_evidence_sources
    WHERE source_id IN (${placeholders})
  `;

  const rows = db.prepare(query).all(...sourceIds) as Array<{
    source_id: string;
    tipo_fonte: string;
    status_evidencia: string;
    nome_documento: string;
    versao_revisao?: string | null;
    capitulo_secao?: string | null;
    pagina_tabela?: string | null;
    homologado_por?: string | null;
  }>;

  return rows.map(r => ({
    sourceId: r.source_id,
    tipoFonte: r.tipo_fonte as TemparioSourceType,
    statusEvidencia: r.status_evidencia as TemparioEvidenceStatus,
    nomeDocumento: r.nome_documento,
    versaoRevisao: r.versao_revisao || undefined,
    capituloSecao: r.capitulo_secao || undefined,
    paginaTabela: r.pagina_tabela || undefined,
    homologadoPor: r.homologado_por || undefined
  }));
}

/**
 * Persiste no catálogo relacional e FTS do SQLite um novo veículo/procedimento
 * aprendido dinamicamente via pesquisa web técnica (Spec 063: Auto-Persistência).
 * Permite que consultas subsequentes sejam resolvidas localmente em < 10ms.
 */
export function persistLearnedTemparioCatalog(
  db: Database.Database,
  pkg: LearnedTemparioPackage
): { vehicleId: string; operationId: string } {
  ensureTemparioTables(db);

  const marcaClean = (pkg.veiculoMarca || '').trim();
  const modeloClean = (pkg.veiculoModelo || '').trim();

  // Trava Anti-Alucinação: proíbe categoricamente gravar placeholders ou operações de 1 passo genérico
  if (!isValidVehicleForPersistence(marcaClean, modeloClean)) {
    return { vehicleId: '', operationId: '' };
  }
  if (!pkg.operacaoNome || pkg.operacaoNome.trim().length < 3 || pkg.operacaoNome.toLowerCase().includes('servico mecanico geral')) {
    return { vehicleId: '', operationId: '' };
  }
  if (!pkg.passos || pkg.passos.length < 2) {
    return { vehicleId: '', operationId: '' };
  }

  const slugMarca = marcaClean.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slugModelo = modeloClean.toLowerCase().replace(/[^a-z0-9]/g, '');
  const vehicleId = `veh_${slugMarca}_${slugModelo}_${pkg.anoInicio}_${pkg.anoFim}`;
  const slugOp = pkg.operacaoNome.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const operationId = `op_${slugMarca}_${slugModelo}_${slugOp}_${pkg.anoInicio}`;

  const tx = db.transaction(() => {
    // 1. Veículo
    db.prepare(`
      INSERT INTO tempario_vehicles (vehicle_id, marca, modelo, geracao, ano_inicio, ano_fim, categoria)
      VALUES (?, ?, ?, ?, ?, ?, 'PASSEIO')
      ON CONFLICT(vehicle_id) DO UPDATE SET
        geracao = COALESCE(excluded.geracao, tempario_vehicles.geracao)
    `).run(
      vehicleId,
      marcaClean,
      modeloClean,
      pkg.geracaoNome || null,
      pkg.anoInicio,
      pkg.anoFim
    );

    // 2. Motor
    const engineName = pkg.motorNome || '1.4 / 1.6 Flex';
    const slugMotor = engineName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const engineId = `eng_${vehicleId}_${slugMotor}`;
    db.prepare(`
      INSERT INTO tempario_engines (engine_id, vehicle_id, codigo_motor, descricao_comercial, cilindrada, valvulas, aspiracao, combustivel)
      VALUES (?, ?, ?, ?, '1.6', 8, 'ASPIRADO', 'FLEX')
      ON CONFLICT(engine_id) DO NOTHING
    `).run(
      engineId,
      vehicleId,
      engineName,
      engineName
    );

    // 3. Fonte de Evidência
    const sourceId = `src_web_${slugMarca}_${slugModelo}`;
    db.prepare(`
      INSERT INTO tempario_evidence_sources (source_id, tipo_fonte, status_evidencia, nome_documento)
      VALUES (?, 'ESTIMATIVA_EXTERNA', 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO', ?)
      ON CONFLICT(source_id) DO UPDATE SET
        nome_documento = excluded.nome_documento
    `).run(
      sourceId,
      pkg.fonteUrlOuNome || 'Manual Técnico Multimarcas / Portal do Reparador'
    );

    // 4. Operação
    const codigoOp = `OP-${slugModelo.toUpperCase()}-${pkg.anoInicio}`;
    const normOp = pkg.operacaoNome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const categoriaServico = (normOp.includes('farol') || normOp.includes('lampada') || normOp.includes('lanterna'))
      ? 'ILUMINACAO'
      : (normOp.includes('radiador') || normOp.includes('arrefecimento') || normOp.includes('bomba d') || normOp.includes('termostat') || normOp.includes('ventoinha'))
        ? 'ARREFECIMENTO'
        : (normOp.includes('correia') || normOp.includes('corrente') || normOp.includes('cabecote'))
          ? 'MOTOR_DISTRIBUICAO'
          : (normOp.includes('partida') || normOp.includes('arranque') || normOp.includes('alternador') || normOp.includes('bateria') || normOp.includes('bobina') || normOp.includes('vela'))
            ? 'ELETRICA_PARTIDA'
            : (normOp.includes('bieleta') || normOp.includes('amortecedor') || normOp.includes('bandeja') || normOp.includes('pivo') || normOp.includes('coxim') || normOp.includes('bucha') || normOp.includes('suspensao'))
              ? 'SUSPENSAO'
              : (normOp.includes('freio') || normOp.includes('pastilha') || normOp.includes('disco'))
                ? 'FREIOS'
                : 'MECANICA_GERAL';

    const sinonimos = JSON.stringify([pkg.operacaoNome, modeloClean, `${modeloClean} ${pkg.operacaoNome}`]);

    db.prepare(`
      INSERT INTO tempario_operations (
        operation_id, codigo_operacao_oem, vehicle_id, engine_id, titulo,
        sinonimos_busca, categoria_servico, tempo_padrao_bruto_horas, fator_variacao_motor,
        grau_dificuldade, source_id, status_evidencia
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1.0, 'MEDIO', ?, 'HISTORICO_OS_REDE')
      ON CONFLICT(operation_id) DO UPDATE SET
        tempo_padrao_bruto_horas = excluded.tempo_padrao_bruto_horas,
        titulo = excluded.titulo,
        sinonimos_busca = excluded.sinonimos_busca
    `).run(
      operationId,
      codigoOp,
      vehicleId,
      engineId,
      pkg.operacaoNome,
      sinonimos,
      categoriaServico,
      pkg.tempoPadraoHoras,
      sourceId
    );

    // 5. Sub-operações e arestas
    db.prepare(`
      DELETE FROM tempario_dependencies_edges 
      WHERE from_node_id = ? AND from_node_type = 'OPERATION'
    `).run(operationId);

    const insertSub = db.prepare(`
      INSERT INTO tempario_suboperations (
        subop_id, codigo_etapa, titulo, descricao_tecnica, fase_execucao,
        tempo_horas, ferramentas_json, torque_especificado, is_acesso_compartilhado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(subop_id) DO UPDATE SET
        titulo = excluded.titulo, descricao_tecnica = excluded.descricao_tecnica,
        fase_execucao = excluded.fase_execucao, tempo_horas = excluded.tempo_horas,
        ferramentas_json = excluded.ferramentas_json, torque_especificado = excluded.torque_especificado
    `);

    const insertEdge = db.prepare(`
      INSERT INTO tempario_dependencies_edges (
        edge_id, from_node_id, from_node_type, to_subop_id, relation_type, ordem_local, obrigatorio
      ) VALUES (?, ?, 'OPERATION', ?, 'TEM_SUBOP', ?, 1)
      ON CONFLICT(edge_id) DO NOTHING
    `);

    if (pkg.passos && pkg.passos.length > 0) {
      for (const p of pkg.passos) {
        const subId = `sub_${operationId}_${p.ordem}`;
        const dbFase =
          p.fase === 'PRE_REQUISITO' || p.fase === 'ACESSO' || p.fase === 'DESMONTAGEM'
            ? 'DESMONTAGEM'
            : p.fase === 'FINALIZACAO' || p.fase === 'TESTE_AJUSTE'
              ? 'TESTE_AJUSTE'
              : p.fase === 'REMONTAGEM'
                ? 'REMONTAGEM'
                : 'EXECUCAO';
        insertSub.run(
          subId,
          `STEP-${p.ordem}`,
          p.titulo,
          p.titulo,
          dbFase,
          p.tempoHoras,
          JSON.stringify(p.ferramentas || []),
          p.torque || null
        );
        insertEdge.run(`edge_${subId}`, operationId, subId, p.ordem);
      }
    } else {
      const subId = `sub_${operationId}_1`;
      insertSub.run(
        subId,
        'STEP-1',
        pkg.operacaoNome,
        pkg.operacaoNome,
        'EXECUCAO',
        pkg.tempoPadraoHoras,
        JSON.stringify(pkg.ferramentas || []),
        pkg.torques?.[0] || null
      );
      insertEdge.run(`edge_${subId}`, operationId, subId, 1);
    }

    // 6. Peças
    db.prepare('DELETE FROM tempario_operation_parts WHERE operation_id = ?').run(operationId);
    if (pkg.pecas && pkg.pecas.length > 0) {
      const insertPart = db.prepare(`
        INSERT INTO tempario_operation_parts (
          part_item_id, operation_id, nome_peca, codigo_referencia, quantidade, unidade, obrigatoria, especificacao_tecnica, observacao
        ) VALUES (?, ?, ?, null, ?, ?, ?, ?, null)
      `);
      for (let i = 0; i < pkg.pecas.length; i++) {
        const p = pkg.pecas[i];
        insertPart.run(
          `part_${operationId}_${i + 1}`,
          operationId,
          p.nomePeca,
          p.quantidade || 1,
          p.unidade || 'UN',
          p.obrigatoria ? 1 : 0,
          p.especificacaoTecnica || null
        );
      }
    }

    // 7. Chunks e FTS
    const chunkId = `chk_${operationId}`;
    const chunkTexto = `${pkg.operacaoNome} para ${modeloClean} (${pkg.anoInicio}-${pkg.anoFim}). Tempo: ${pkg.tempoPadraoHoras}h. Ferramentas: ${pkg.ferramentas.join(', ')}`;
    db.prepare(`
      INSERT INTO tempario_procedure_chunks (
        chunk_id, operation_id, vehicle_id, engine_id, source_id,
        titulo_contexto, conteudo_texto, metadados_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
      ON CONFLICT(chunk_id) DO UPDATE SET
        conteudo_texto = excluded.conteudo_texto,
        titulo_contexto = excluded.titulo_contexto
    `).run(
      chunkId,
      operationId,
      vehicleId,
      engineId,
      sourceId,
      pkg.operacaoNome,
      chunkTexto
    );

    db.prepare('DELETE FROM tempario_fts WHERE operation_id = ?').run(operationId);
    db.prepare(`
      INSERT INTO tempario_fts (chunk_id, operation_id, titulo_contexto, conteudo_texto)
      VALUES (?, ?, ?, ?)
    `).run(
      chunkId,
      operationId,
      `${modeloClean} ${pkg.operacaoNome}`,
      `${modeloClean} ${marcaClean} ${pkg.operacaoNome} ${pkg.anoInicio} ${pkg.anoFim} ${pkg.ferramentas.join(' ')}`
    );
  });

  tx();
  return { vehicleId, operationId };
}
