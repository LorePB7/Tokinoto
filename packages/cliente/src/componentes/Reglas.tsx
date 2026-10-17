import { useEffect, useRef, useState, type KeyboardEvent as TeclaReact } from 'react';
import { Carta } from './Carta';

/** De menor a mayor. Los palos no cuentan, así que se muestran todas con el mismo. */
const VALORES = [
  ...['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map((rango) => `${rango}-picas`),
  'COMODIN',
];

type Pestana = 'juego' | 'cartas' | 'puntos' | 'pie';

const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'juego', nombre: 'Juego' },
  { id: 'cartas', nombre: 'Cartas' },
  { id: 'puntos', nombre: 'Puntos' },
  { id: 'pie', nombre: 'El Pié' },
];

function PanelReglas({ alCerrar }: { alCerrar: () => void }) {
  const cerrar = useRef<HTMLButtonElement>(null);
  // Las reglas se reparten en pestañas para que cada una entre en la pantalla sin scroll.
  const [pestana, setPestana] = useState<Pestana>('juego');

  useEffect(() => {
    cerrar.current?.focus();
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') alCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [alCerrar]);

  function alTeclearPestana(evento: TeclaReact<HTMLDivElement>) {
    const paso = evento.key === 'ArrowRight' ? 1 : evento.key === 'ArrowLeft' ? -1 : 0;
    if (paso === 0) return;
    evento.preventDefault();
    const actual = PESTANAS.findIndex((p) => p.id === pestana);
    const siguiente = PESTANAS[(actual + paso + PESTANAS.length) % PESTANAS.length]!;
    setPestana(siguiente.id);
    document.getElementById(`pestana-reglas-${siguiente.id}`)?.focus();
  }

  return (
    <aside id="panel-reglas" className="panel-reglas" role="dialog" aria-label="Reglas del juego">
      <header className="encabezado-reglas">
        <h2>Reglas del juego</h2>
        <button ref={cerrar} type="button" className="boton chico" onClick={alCerrar}>
          Cerrar
        </button>
      </header>

      <div className="pestanas pestanas-reglas" role="tablist" aria-label="Temas de las reglas" onKeyDown={alTeclearPestana}>
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            id={`pestana-reglas-${p.id}`}
            aria-selected={pestana === p.id}
            aria-controls="contenido-reglas"
            tabIndex={pestana === p.id ? 0 : -1}
            className={`pestana ${pestana === p.id ? 'activa' : ''}`}
            onClick={() => setPestana(p.id)}
          >
            {p.nombre}
          </button>
        ))}
      </div>

      <div id="contenido-reglas" className="contenido-reglas" role="tabpanel" aria-labelledby={`pestana-reglas-${pestana}`}>
        {pestana === 'juego' && (
          <>
            <section>
              <h3>De qué se trata</h3>
              <p>
                Antes de jugar, cada uno apuesta cuántas bazas va a ganar. Gana quien mejor acierte a lo largo de las 14
                partidas.
              </p>
            </section>

            <section>
              <h3>Cada partida</h3>
              <ol>
                <li>
                  <b>Se reparte.</b> En la partida 1 son 1 carta por jugador, y así: 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1.
                </li>
                <li>
                  <b>Se apuesta.</b> Cada uno elige cuántas bazas va a ganar, de 0 hasta la cantidad de cartas. Apuesta
                  primero el Mano y se sigue hacia la derecha.
                </li>
                <li>
                  <b>Se juega por bazas.</b> El Mano tira una carta y los demás tiran una cada uno, hacia la derecha. Gana la
                  baza la carta más alta; si dos valen lo mismo, gana la que se tiró primero. Quien gana abre la baza
                  siguiente.
                </li>
                <li>
                  <b>Se cuentan los puntos</b> cuando se terminan las cartas.
                </li>
              </ol>
            </section>
          </>
        )}

        {pestana === 'cartas' && (
          <section>
            <h3>Valor de las cartas</h3>
            <p>De menor a mayor:</p>
            <div className="valores-cartas" role="list" aria-label="Cartas de menor a mayor">
              {VALORES.map((id) => (
                <span role="listitem" key={id}>
                  <Carta id={id} tamano="s" />
                </span>
              ))}
            </div>
            <p>El Comodín le gana a todas, incluso al As. Los palos no cuentan: solo el número o la letra.</p>
          </section>
        )}

        {pestana === 'pie' && (
          <>
            <section>
              <h3>El Pié</h3>
              <p>
                El Pié es quien reparte y apuesta último. No puede elegir el número que haría que todas las apuestas sumen
                justo la cantidad de cartas: así siempre hay alguien que se equivoca.
              </p>
            </section>

            <section>
              <h3>Si tardás</h3>
              <p>Cada jugada tiene tiempo límite. Si se vence, juega el piloto automático por vos.</p>
            </section>
          </>
        )}

        {pestana === 'puntos' && (
          <>
            <section>
              <h3>Puntos</h3>
              <p>
                Si ganás <b>exactamente</b> las bazas que apostaste, sumás 5 puntos más tu apuesta. Si ganás más o menos,
                sumás 0.
              </p>
              <p className="nota">Apostar 2 y ganar 2 = 7 puntos. Apostar 0 y ganar 0 = 5 puntos.</p>
              <p>
                Cada apuesta se ve como una ficha bordó junto al nombre. Las bazas ganadas se apilan al lado: la ficha
                encima del montón marca una baza que entra en tu apuesta.
              </p>
            </section>

            <section>
              <h3>Quién gana</h3>
              <p>
                Gana quien suma más puntos después de la partida 14. Si hay empate, se compara la mejor partida de cada uno;
                si sigue el empate, la segunda mejor, y así. Si nada lo resuelve, comparten el podio.
              </p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

/** Botón "Reglas" que abre un panel al costado, con las reglas y el valor de las cartas. */
export function BotonReglas({ flotante = false }: { flotante?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const [cerrarPanel] = useState(() => () => {
    setAbierto(false);
    boton.current?.focus();
  });

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-label="Reglas"
        className={`boton chico secundario boton-reglas ${flotante ? 'flotante' : ''}`}
        aria-expanded={abierto}
        aria-controls="panel-reglas"
        onClick={() => setAbierto((actual) => !actual)}
      >
        <span className="signo" aria-hidden="true">
          ?
        </span>
        <span className="texto-boton">Reglas</span>
      </button>
      {abierto && <PanelReglas alCerrar={cerrarPanel} />}
    </>
  );
}
