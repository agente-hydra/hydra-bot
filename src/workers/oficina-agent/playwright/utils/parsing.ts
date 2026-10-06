import xlsx from 'xlsx';
import * as fs from 'fs';

/**
 * Lê um Excel WebForms sujo e encontra a linha de cabeçalho dinamicamente
 * baseando-se em uma coluna esperada.
 */
export function parseWebFormsExcel(filePath: string, expectedHeaderColumn: string) {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    
    let headerIdx = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
        if (rows[i].some(c => String(c).toUpperCase().includes(expectedHeaderColumn.toUpperCase()))) {
            headerIdx = i;
            break;
        }
    }
    
    if (headerIdx === -1) {
        throw new Error(`Cabeçalho não encontrado contendo a coluna: ${expectedHeaderColumn}`);
    }
    
    const headers = rows[headerIdx].map(String);
    const dataRows = rows.slice(headerIdx + 1);

    return {
        headers,
        dataRows,
        rawRows: rows,
        headerIdx
    };
}

/**
 * Encontra a última linha que contenha uma palavra chave (como TOTAL)
 */
export function findTotalRow(rows: any[][], searchKeyword = 'TOTAL') {
    for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].some(c => String(c).toUpperCase().includes(searchKeyword.toUpperCase()))) {
            return rows[i];
        }
    }
    return null;
}
