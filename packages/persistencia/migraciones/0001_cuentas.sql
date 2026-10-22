CREATE TABLE "cuentas" (
	"id" text PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"nombre" text NOT NULL,
	"creada_en" timestamp with time zone NOT NULL,
	CONSTRAINT "cuentas_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "jugadores_de_juego" ADD COLUMN "cuenta_id" text;--> statement-breakpoint
ALTER TABLE "jugadores_de_juego" ADD COLUMN "invitado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jugadores_de_juego" ADD CONSTRAINT "jugadores_de_juego_cuenta_id_cuentas_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuentas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jugadores_cuenta_idx" ON "jugadores_de_juego" USING btree ("cuenta_id");