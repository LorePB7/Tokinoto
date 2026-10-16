CREATE TABLE "eventos" (
	"juego_id" text NOT NULL,
	"seq" integer NOT NULL,
	"tipo" text NOT NULL,
	"datos" jsonb NOT NULL,
	CONSTRAINT "eventos_juego_id_seq_pk" PRIMARY KEY("juego_id","seq")
);
--> statement-breakpoint
CREATE TABLE "juegos" (
	"id" text PRIMARY KEY NOT NULL,
	"sala_codigo" text NOT NULL,
	"estado" text NOT NULL,
	"motivo_aborto" text,
	"config" jsonb NOT NULL,
	"total_partidas" integer NOT NULL,
	"iniciado_en" timestamp with time zone NOT NULL,
	"terminado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jugadores_de_juego" (
	"juego_id" text NOT NULL,
	"asiento" integer NOT NULL,
	"id_jugador" text NOT NULL,
	"nombre" text NOT NULL,
	CONSTRAINT "jugadores_de_juego_juego_id_asiento_pk" PRIMARY KEY("juego_id","asiento")
);
--> statement-breakpoint
CREATE TABLE "puntajes_de_partida" (
	"juego_id" text NOT NULL,
	"partida" integer NOT NULL,
	"asiento" integer NOT NULL,
	"apuesta" integer NOT NULL,
	"bazas_ganadas" integer NOT NULL,
	"puntos" integer NOT NULL,
	CONSTRAINT "puntajes_de_partida_juego_id_partida_asiento_pk" PRIMARY KEY("juego_id","partida","asiento")
);
--> statement-breakpoint
CREATE TABLE "ranking_final" (
	"juego_id" text NOT NULL,
	"asiento" integer NOT NULL,
	"total" integer NOT NULL,
	"puesto" integer NOT NULL,
	CONSTRAINT "ranking_final_juego_id_asiento_pk" PRIMARY KEY("juego_id","asiento")
);
--> statement-breakpoint
CREATE TABLE "salas" (
	"codigo" text PRIMARY KEY NOT NULL,
	"creada_en" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_juego_id_juegos_id_fk" FOREIGN KEY ("juego_id") REFERENCES "public"."juegos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "juegos" ADD CONSTRAINT "juegos_sala_codigo_salas_codigo_fk" FOREIGN KEY ("sala_codigo") REFERENCES "public"."salas"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jugadores_de_juego" ADD CONSTRAINT "jugadores_de_juego_juego_id_juegos_id_fk" FOREIGN KEY ("juego_id") REFERENCES "public"."juegos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntajes_de_partida" ADD CONSTRAINT "puntajes_de_partida_juego_id_juegos_id_fk" FOREIGN KEY ("juego_id") REFERENCES "public"."juegos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_final" ADD CONSTRAINT "ranking_final_juego_id_juegos_id_fk" FOREIGN KEY ("juego_id") REFERENCES "public"."juegos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "juegos_sala_idx" ON "juegos" USING btree ("sala_codigo","iniciado_en");