/**
 * feriados_calendario.ts
 *
 * Módulo Soberano de Calendário Operacional e Feriados Brasileiros para a Rede Hydra.
 * Suporta tipagem estrita para o subsistema TypeScript (hydra-sync).
 */

export interface InformacaoFeriado {
  readonly isFeriado: boolean;
  readonly nome?: string;
  readonly tipo?: 'nacional_fixo' | 'nacional_movel' | 'estadual_sp' | 'customizado';
  readonly dataISO: string;
}

export interface JanelaAcumulada {
  readonly dataInicioBR: string;
  readonly dataFimBR: string;
  readonly dataInicioISO: string;
  readonly dataFimISO: string;
  readonly dateTagBR: string;
  readonly datasAlvoBR: readonly string[];
  readonly datasAlvoISO: readonly string[];
  readonly diasCobertos: number;
  readonly isPeriodoEstendido: boolean;
  readonly motivo: 'dia_comum' | 'segunda_feira' | 'pos_feriado';
  readonly descricao: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatarDataBR(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

export function formatarDataISO(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function formatarDataTag(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `${pad2(d)}-${pad2(m)}-${y}`;
}

export function normalizarData(input: Date | string): Date {
  if (input instanceof Date) {
    return new Date(input.getFullYear(), input.getMonth(), input.getDate(), 12, 0, 0);
  }
  if (typeof input === 'string') {
    const s = input.trim();
    if (s.includes('-')) {
      const parts = s.split('T')[0].split('-');
      if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
      }
    }
    if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 12, 0, 0);
      }
    }
  }
  return new Date();
}

export function calcularDataPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia, 12, 0, 0);
}

export function obterFeriadosAno(ano: number): Map<string, { nome: string; tipo: 'nacional_fixo' | 'nacional_movel' }> {
  const feriados = new Map<string, { nome: string; tipo: 'nacional_fixo' | 'nacional_movel' }>();

  const fixos = [
    { mes: 1, dia: 1, nome: 'Confraternização Universal (Ano Novo)' },
    { mes: 4, dia: 21, nome: 'Tiradentes' },
    { mes: 5, dia: 1, nome: 'Dia Mundial do Trabalho' },
    { mes: 9, dia: 7, nome: 'Independência do Brasil' },
    { mes: 10, dia: 12, nome: 'Nossa Senhora Aparecida (Padroeira do Brasil)' },
    { mes: 11, dia: 2, nome: 'Finados' },
    { mes: 11, dia: 15, nome: 'Proclamação da República' },
    { mes: 11, dia: 20, nome: 'Dia Nacional de Zumbi e da Consciência Negra' },
    { mes: 12, dia: 25, nome: 'Natal' }
  ];

  for (const f of fixos) {
    const chave = `${ano}-${pad2(f.mes)}-${pad2(f.dia)}`;
    feriados.set(chave, { nome: f.nome, tipo: 'nacional_fixo' });
  }

  const pascoa = calcularDataPascoa(ano);

  const adicionarOffset = (offsetDias: number, nome: string, tipo: 'nacional_movel') => {
    const d = new Date(pascoa);
    d.setDate(pascoa.getDate() + offsetDias);
    const chave = formatarDataISO(d);
    feriados.set(chave, { nome, tipo });
  };

  adicionarOffset(-48, 'Segunda-feira de Carnaval', 'nacional_movel');
  adicionarOffset(-47, 'Terça-feira de Carnaval', 'nacional_movel');
  adicionarOffset(-2, 'Sexta-feira Santa (Paixão de Cristo)', 'nacional_movel');
  adicionarOffset(60, 'Corpus Christi', 'nacional_movel');

  return feriados;
}

const cacheFeriados = new Map<number, Map<string, { nome: string; tipo: 'nacional_fixo' | 'nacional_movel' }>>();

function getFeriadosAnoCached(ano: number): Map<string, { nome: string; tipo: 'nacional_fixo' | 'nacional_movel' }> {
  if (!cacheFeriados.has(ano)) {
    cacheFeriados.set(ano, obterFeriadosAno(ano));
  }
  return cacheFeriados.get(ano)!;
}

export function verificarFeriado(inputData: Date | string): InformacaoFeriado {
  const d = normalizarData(inputData);
  const ano = d.getFullYear();
  const iso = formatarDataISO(d);
  const mapa = getFeriadosAnoCached(ano);

  if (mapa.has(iso)) {
    const f = mapa.get(iso)!;
    return {
      isFeriado: true,
      nome: f.nome,
      tipo: f.tipo,
      dataISO: iso
    };
  }

  return {
    isFeriado: false,
    dataISO: iso
  };
}

export function isDiaDespachoMatinal(inputData: Date | string): boolean {
  const d = normalizarData(inputData);
  const diaSemana = d.getDay();
  if (diaSemana === 0 || diaSemana === 6) {
    return false;
  }
  const feriadoInfo = verificarFeriado(d);
  return !feriadoInfo.isFeriado;
}

export function calcularJanelaAcumulada(dataRef: Date | string = new Date()): JanelaAcumulada {
  const hoje = normalizarData(dataRef);
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);

  let cursor = new Date(ontem);
  while (!isDiaDespachoMatinal(cursor)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  const dataInicio = new Date(cursor);
  const dataFim = new Date(ontem);

  const datasAlvoBR: string[] = [];
  const datasAlvoISO: string[] = [];

  const temp = new Date(dataInicio);
  while (temp <= dataFim) {
    datasAlvoBR.push(formatarDataBR(temp));
    datasAlvoISO.push(formatarDataISO(temp));
    temp.setDate(temp.getDate() + 1);
  }

  const diasCobertos = datasAlvoBR.length;
  const isPeriodoEstendido = diasCobertos > 1;

  let motivo: 'dia_comum' | 'segunda_feira' | 'pos_feriado' = 'dia_comum';
  let descricao = `Dia comum: data de ontem (${datasAlvoBR[0]})`;

  const feriadosNoIntervalo = datasAlvoISO
    .map(iso => verificarFeriado(iso))
    .filter(f => f.isFeriado);

  if (feriadosNoIntervalo.length > 0) {
    motivo = 'pos_feriado';
    const nomesFeriados = feriadosNoIntervalo.map(f => f.nome).join(', ');
    descricao = `Período acumulado pós-feriado de ${datasAlvoBR[0]} a ${datasAlvoBR[datasAlvoBR.length - 1]} (cobre: ${nomesFeriados} e fim de semana)`;
  } else if (hoje.getDay() === 1) {
    motivo = 'segunda_feira';
    descricao = `Segunda-feira: período estendido de sexta-feira a domingo (${datasAlvoBR[0]} a ${datasAlvoBR[datasAlvoBR.length - 1]})`;
  }

  return {
    dataInicioBR: datasAlvoBR[0],
    dataFimBR: datasAlvoBR[datasAlvoBR.length - 1],
    dataInicioISO: datasAlvoISO[0],
    dataFimISO: datasAlvoISO[datasAlvoISO.length - 1],
    dateTagBR: formatarDataTag(hoje),
    datasAlvoBR,
    datasAlvoISO,
    diasCobertos,
    isPeriodoEstendido,
    motivo,
    descricao
  };
}
