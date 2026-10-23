/**
 * Repositorio en memoria: mismo contrato que el de PostgreSQL, sin base de
 * datos. Sirve para pruebas y para correr el servidor sin persistencia real.
 */
import { randomUUID } from 'node:crypto';
import {
  efectosDeEvento,
  type Cuenta,
  type DatosJuego,
  type EventoGuardado,
  type JuegoGuardado,
  type Repositorio,
  type ResumenJuego,
} from './tipos';

export function crearRepositorioEnMemoria(): Repositorio {
  const juegos = new Map<string, JuegoGuardado>();
  const eventos = new Map<string, Map<number, EventoGuardado>>();
  const cuentas = new Map<string, Cuenta>();

  const resumen = (juego: JuegoGuardado): ResumenJuego => ({
    id: juego.id,
    sala: juego.sala,
    estado: juego.estado,
    motivoAborto: juego.motivoAborto,
    totalPartidas: juego.totalPartidas,
    cantidadJugadores: juego.jugadores.length,
    iniciadoEn: juego.iniciadoEn,
    terminadoEn: juego.terminadoEn,
  });

  return {
    async abrirJuego(datos: DatosJuego) {
      if (juegos.has(datos.id)) return;
      juegos.set(datos.id, {
        id: datos.id,
        sala: datos.sala,
        estado: 'EN_CURSO',
        motivoAborto: null,
        config: structuredClone(datos.config),
        totalPartidas: datos.config.cardsPerRound.length,
        cantidadJugadores: datos.jugadores.length,
        iniciadoEn: datos.iniciadoEn,
        terminadoEn: null,
        jugadores: datos.jugadores.map((j, asiento) => ({
          asiento,
          idJugador: j.idJugador,
          nombre: j.nombre,
          cuentaId: j.cuentaId ?? null,
          invitado: j.invitado ?? false,
          bot: j.bot ?? null,
        })),
        puntajes: [],
        ranking: [],
      });
      eventos.set(datos.id, new Map());
    },

    async agregarEventos(juegoId, lote, cuando) {
      const juego = juegos.get(juegoId);
      const registro = eventos.get(juegoId);
      if (!juego || !registro) throw new Error(`No existe el juego ${juegoId}`);
      for (const { seq, evento } of lote) {
        if (registro.has(seq)) continue;
        registro.set(seq, { seq, evento: structuredClone(evento) });
        const efectos = efectosDeEvento(evento);
        for (const p of efectos.puntajes) {
          if (!juego.puntajes.some((q) => q.partida === p.partida && q.asiento === p.asiento)) juego.puntajes.push(p);
        }
        if (efectos.ranking.length > 0 && juego.ranking.length === 0) juego.ranking = efectos.ranking;
        if (efectos.cierre && juego.estado === 'EN_CURSO') {
          juego.estado = efectos.cierre.estado;
          juego.motivoAborto = efectos.cierre.motivo;
          juego.terminadoEn = cuando;
        }
      }
      juego.puntajes.sort((a, b) => a.partida - b.partida || a.asiento - b.asiento);
      juego.ranking.sort((a, b) => a.puesto - b.puesto || a.asiento - b.asiento);
    },

    async abortarEnCurso(motivo, cuando) {
      let cantidad = 0;
      for (const juego of juegos.values()) {
        if (juego.estado !== 'EN_CURSO') continue;
        const registro = eventos.get(juego.id);
        const seq = registro ? Math.max(-1, ...registro.keys()) + 1 : 0;
        registro?.set(seq, { seq, evento: { type: 'JUEGO_ABORTADO', reason: motivo } });
        juego.estado = 'ABORTADO';
        juego.motivoAborto = motivo;
        juego.terminadoEn = cuando;
        cantidad++;
      }
      return cantidad;
    },

    async listarJuegos(opciones = {}) {
      return [...juegos.values()]
        .filter((j) => opciones.sala === undefined || j.sala === opciones.sala)
        .filter((j) => opciones.cuenta === undefined || j.jugadores.some((p) => p.cuentaId === opciones.cuenta))
        .sort((a, b) => b.iniciadoEn.getTime() - a.iniciadoEn.getTime())
        .slice(0, opciones.limite ?? 50)
        .map(resumen);
    },

    async obtenerJuego(id) {
      const juego = juegos.get(id);
      return juego ? structuredClone(juego) : null;
    },

    async eventosDe(juegoId) {
      return [...(eventos.get(juegoId)?.values() ?? [])].sort((a, b) => a.seq - b.seq).map((e) => structuredClone(e));
    },

    async cuentaDeGoogle(googleSub, nombreInicial, cuando) {
      for (const cuenta of cuentas.values()) if (cuenta.googleSub === googleSub) return { ...cuenta };
      const cuenta: Cuenta = { id: randomUUID(), googleSub, nombre: nombreInicial, creadaEn: cuando };
      cuentas.set(cuenta.id, cuenta);
      return { ...cuenta };
    },

    async obtenerCuenta(id) {
      const cuenta = cuentas.get(id);
      return cuenta ? { ...cuenta } : null;
    },

    async cambiarNombreCuenta(id, nombre) {
      const cuenta = cuentas.get(id);
      if (!cuenta) return null;
      cuenta.nombre = nombre;
      return { ...cuenta };
    },

    async cerrar() {},
  };
}
