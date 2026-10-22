import { LARGO_MAXIMO_CHAT, type MensajeDeChat } from '@tokinoto/protocolo';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTienda } from '../estado/contexto';
import { Panel } from './Panel';

const SIN_MENSAJES: MensajeDeChat[] = [];

/** Globo de diálogo: el ícono del botón Chat. */
function IconoChat() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V13h0.5A2.5 2.5 0 0 1 3 10.5z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Cuántos mensajes de otras personas llegaron después del último que la persona vio. */
function useSinLeer(): number {
  const chat = useTienda((s) => s.seguimiento.sala?.chat ?? SIN_MENSAJES);
  const yo = useTienda((s) => s.seguimiento.sala?.yo);
  const leido = useTienda((s) => s.chatLeido);
  return chat.filter((m) => m.id > leido && m.idJugador !== yo).length;
}

function hora(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

/** Contenido del panel de chat: los mensajes y el campo para escribir. */
function ContenidoChat({ campo }: { campo: RefObject<HTMLInputElement | null> }) {
  const chat = useTienda((s) => s.seguimiento.sala?.chat ?? SIN_MENSAJES);
  const yo = useTienda((s) => s.seguimiento.sala?.yo);
  const enviarChat = useTienda((s) => s.enviarChat);
  const marcarChatLeido = useTienda((s) => s.marcarChatLeido);
  const conectado = useTienda((s) => s.conexion === 'conectada');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const lista = useRef<HTMLOListElement>(null);

  // Con el panel abierto, todo lo que llega queda leído y la lista baja al último mensaje.
  const ultimo = chat.at(-1)?.id ?? 0;
  useEffect(() => {
    marcarChatLeido();
    const elemento = lista.current;
    if (elemento) elemento.scrollTop = elemento.scrollHeight;
  }, [ultimo, marcarChatLeido]);

  async function alEnviar(evento: FormEvent) {
    evento.preventDefault();
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    const ok = await enviarChat(limpio);
    setEnviando(false);
    if (ok) setTexto('');
    campo.current?.focus();
  }

  return (
    <div className="chat">
      <p className="nota chat-aviso">Los mensajes se borran al terminar.</p>
      <ol ref={lista} className="chat-mensajes" aria-label="Conversación" aria-live="polite">
        {chat.length === 0 && <li className="chat-vacio">Todavía no hay mensajes.</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.idJugador === yo ? 'propio' : ''}>
            <span className="chat-autor">
              {m.idJugador === yo ? 'Vos' : m.nombre}
              <time className="chat-hora" dateTime={new Date(m.hora).toISOString()}>
                {hora(m.hora)}
              </time>
            </span>
            {/* Siempre como texto: React lo escapa y los enlaces no se vuelven clickeables. */}
            <span className="chat-texto">{m.texto}</span>
          </li>
        ))}
      </ol>
      <form className="chat-formulario" onSubmit={(e) => void alEnviar(e)}>
        <input
          ref={campo}
          type="text"
          aria-label="Mensaje"
          placeholder="Escribí un mensaje"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={LARGO_MAXIMO_CHAT}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button type="submit" className="boton chico" disabled={!texto.trim() || enviando || !conectado}>
          Enviar
        </button>
      </form>
    </div>
  );
}

/**
 * Botón Chat (fase 7): en la barra de la mesa, al lado de Puntos, y flotante en
 * la sala de espera. Muestra cuántos mensajes de otros hay sin leer y abre el
 * chat en el panel unificado.
 */
export function BotonChat({ flotante = false }: { flotante?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const sinLeer = useSinLeer();
  const [cerrar] = useState(() => () => {
    setAbierto(false);
    boton.current?.focus();
  });

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-label={sinLeer > 0 ? `Chat (${sinLeer} sin leer)` : 'Chat'}
        className={`boton chico secundario boton-chat ${flotante ? 'flotante' : ''}`.trim()}
        aria-expanded={abierto}
        aria-controls="panel-chat"
        onClick={() => setAbierto((a) => !a)}
      >
        <span className="signo" aria-hidden="true">
          <IconoChat />
        </span>
        <span className="texto-boton">Chat</span>
        {sinLeer > 0 && (
          <span className="chat-sin-leer" aria-hidden="true">
            {sinLeer > 9 ? '9+' : sinLeer}
          </span>
        )}
      </button>
      {abierto && (
        <Panel
          id="panel-chat"
          titulo="Chat"
          alCerrar={cerrar}
          clase="panel-chat panel-reglas"
          claseEncabezado="encabezado-reglas"
          foco={campo}
        >
          <ContenidoChat campo={campo} />
        </Panel>
      )}
    </>
  );
}
