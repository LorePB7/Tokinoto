import { parseArgs } from 'node:util';

export interface Argumentos {
  juegos: number;
  /** Cantidad fija de jugadores, o 'todos' para alternar de 4 a 7. */
  jugadores: number | 'todos';
  semilla: number;
  detalle: boolean;
  verificar: boolean;
  ayuda: boolean;
}

export const AYUDA = `Simulador de Tokinoto

Juega juegos completos con apuestas y cartas al azar (siempre legales) y
comprueba que el motor de reglas nunca viole un invariante.

Uso:
  npm run simular -w @tokinoto/simulador -- [opciones]

Opciones:
  --juegos N        Cantidad de juegos a simular (por defecto 1000)
  --jugadores N|todos
                    Jugadores por juego, de 4 a 7, o "todos" para alternar
                    de 4 a 7 (por defecto todos)
  --semilla N       Semilla inicial; el juego número i usa semilla + i (por defecto 1)
  --detalle         Cuenta el primer juego completo: manos, apuestas y cada baza
  --sin-verificar   No chequea invariantes tras cada acción (más rápido)
  -h, --ayuda       Muestra esta ayuda

Si algún juego viola una regla, se muestra cómo reproducirlo y el programa
termina con código 1.
`;

/** Traduce los errores del lector de argumentos de Node (que vienen en inglés). */
function explicarErrorDeLectura(error: unknown): string {
  const original = error instanceof Error ? error.message : String(error);
  const codigo = (error as { code?: string } | null)?.code;
  switch (codigo) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return `opción desconocida (${original})`;
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      return 'falta el valor de una opción, o el valor empieza con "-" (los valores deben ser enteros positivos)';
    case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
      return `no se esperaba un argumento suelto (${original})`;
    default:
      return original;
  }
}

function entero(nombre: string, valor: string, minimo: number, maximo: number): number {
  if (!/^\d+$/.test(valor)) {
    throw new Error(`--${nombre} debe ser un número entero (recibí "${valor}")`);
  }
  const numero = Number(valor);
  if (numero < minimo || numero > maximo) {
    throw new Error(`--${nombre} debe estar entre ${minimo} y ${maximo} (recibí ${numero})`);
  }
  return numero;
}

/** Lee los argumentos de la línea de comandos. Lanza Error con un mensaje en español si son inválidos. */
export function leerArgumentos(argv: readonly string[]): Argumentos {
  let valores;
  try {
    ({ values: valores } = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        juegos: { type: 'string' },
        jugadores: { type: 'string' },
        semilla: { type: 'string' },
        detalle: { type: 'boolean', default: false },
        'sin-verificar': { type: 'boolean', default: false },
        ayuda: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    throw new Error(`Argumentos inválidos: ${explicarErrorDeLectura(error)}`);
  }

  const jugadoresTexto = valores.jugadores ?? 'todos';
  return {
    juegos: valores.juegos === undefined ? 1000 : entero('juegos', valores.juegos, 1, 1_000_000),
    jugadores: jugadoresTexto === 'todos' ? 'todos' : entero('jugadores', jugadoresTexto, 4, 7),
    semilla: valores.semilla === undefined ? 1 : entero('semilla', valores.semilla, 0, 2 ** 31 - 1),
    detalle: valores.detalle ?? false,
    verificar: !(valores['sin-verificar'] ?? false),
    ayuda: valores.ayuda ?? false,
  };
}
