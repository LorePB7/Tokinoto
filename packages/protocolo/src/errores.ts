import type { ErrorCode } from '@tokinoto/reglas';

/**
 * Códigos de error que el servidor envía a los clientes
 * (docs/diseno-tecnico.md, sección 4.5). La interfaz reacciona según el código;
 * el mensaje es solo un texto legible en español.
 */
export type CodigoError =
  // Reglas del juego (vienen del motor)
  | 'NO_ES_TU_TURNO'
  | 'ESTADO_INVALIDO'
  | 'APUESTA_FUERA_DE_RANGO'
  | 'APUESTA_PROHIBIDA_PIE'
  | 'APUESTA_YA_REALIZADA'
  | 'CARTA_NO_EN_MANO'
  | 'JUEGO_TERMINADO'
  | 'CANTIDAD_JUGADORES_INVALIDA'
  // Sala
  | 'NO_PERTENECE_A_SALA'
  | 'NO_ES_ANFITRION'
  | 'SALA_LLENA'
  | 'SALA_NO_EXISTE'
  | 'JUEGO_YA_INICIADO'
  | 'JUEGO_NO_INICIADO'
  | 'NOMBRE_EN_USO'
  | 'YA_ESTAS_EN_UNA_SALA'
  | 'SESION_INVALIDA'
  | 'SESION_REEMPLAZADA'
  // Protocolo
  | 'MENSAJE_INVALIDO'
  | 'VERSION_NO_SOPORTADA'
  | 'DEMASIADOS_MENSAJES'
  | 'ERROR_INTERNO';

export interface ErrorServidor {
  codigo: CodigoError;
  mensaje: string;
}

export function error(codigo: CodigoError, mensaje: string): ErrorServidor {
  return { codigo, mensaje };
}

/** Traduce un error del motor de reglas a un error del protocolo. */
export function desdeMotor(codigo: ErrorCode, mensaje: string): ErrorServidor {
  switch (codigo) {
    case 'JUGADOR_DESCONOCIDO':
      return error('NO_PERTENECE_A_SALA', mensaje);
    case 'JUGADORES_DUPLICADOS':
    case 'CONFIGURACION_INVALIDA':
      // No deberían ocurrir: el servidor arma los jugadores y la configuración.
      return error('ERROR_INTERNO', mensaje);
    default:
      return error(codigo, mensaje);
  }
}
