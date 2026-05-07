# Golbit 🎯

Plataforma educativa de trading con simulación avanzada y control total del instructor.

---

## 📋 Estado del proyecto

**Paso 1 completado: Setup inicial**

Lo que ya está listo:
- ✅ Estructura del proyecto Next.js 14 con App Router
- ✅ Tailwind + tema dark trading
- ✅ Cliente Supabase (browser, server, admin)
- ✅ Middleware de protección de rutas
- ✅ Landing, login y registro (UI placeholder)
- ✅ Schema completo de base de datos con RLS y Realtime habilitado

Próximos pasos:
- ⏳ Paso 2: Auth funcional (login/registro)
- ⏳ Paso 3: Wallet básica
- ⏳ Paso 4: Creación de monedas (admin)
- ⏳ Paso 5: Motor de precios + gráfico
- ⏳ Paso 6: Trading
- ⏳ Paso 7: Motor de resultados
- ⏳ Paso 8: Notificaciones realtime
- ⏳ Paso 9: Panel admin completo
- ⏳ Paso 10: Sistema de referidos

---

## 🚀 Setup local

### 1. Requisitos
- Node.js 18+ (recomendado 20)
- npm, pnpm o yarn

### 2. Instalación

```bash
# En la raíz del proyecto
npm install
```

### 3. Configurar Supabase

1. Creá tu proyecto en https://supabase.com (region São Paulo recomendada).
2. Andá a **SQL Editor** → **New query** → pegá todo el contenido de `supabase/schema.sql` → **Run**.
3. Andá a **Project Settings → API** y copiá:
   - Project URL
   - anon key
   - service_role key

### 4. Variables de entorno

Copiá `.env.example` a `.env.local` y completá los valores:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 5. Correr en desarrollo

```bash
npm run dev
```

Abrí http://localhost:3000

### 6. Crear tu usuario admin

Por ahora el formulario está placeholder. En el paso 2 vamos a habilitar auth real. Cuando llegue ese momento:

1. Te registrás normal en la app.
2. En Supabase → SQL Editor:
```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'tu@email.com';
```

---

## 📁 Estructura

```
golbit/
├── app/                    # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx           # Landing
│   ├── login/
│   ├── register/
│   └── globals.css
├── lib/
│   ├── supabase/
│   │   ├── client.ts      # Browser client
│   │   ├── server.ts      # Server client
│   │   └── admin.ts       # Service role client (privilegiado)
│   └── utils.ts
├── supabase/
│   └── schema.sql         # Schema completo con RLS
├── middleware.ts          # Protección de rutas
├── tailwind.config.ts
└── package.json
```

---

## 🎚️ Motor de resultados (resumen)

El núcleo de Golbit es el motor que decide cómo gana o pierde cada usuario.

**Jerarquía de resolución:**
1. Override pre-cargado en la operación específica (`trades.forced_outcome`)
2. Tope casa-gana (`motor_settings.house_max_profit_pool`)
3. Modo del usuario (`outcome_overrides.mode`):
   - `manual` → respeta el fader
   - `low_inv_wins` → si invierte poco, gana
   - `high_inv_loss` → si invierte mucho, pierde
   - `auto_house` → combina ambos
4. Resultado final = fader × monto invertido (sin ruido por default)

**Umbrales configurables:**
- Opción B (% del saldo): poca <5% / entre 5–25% / mucha >25%
- Opción A (% del promedio del usuario): poca <70% / entre 70–130% / mucha >130%

Todos los valores se editan desde el panel admin en `motor_settings`.

---

## 🔔 Notificaciones (sin polling)

Usamos **Supabase Realtime** sobre la tabla `notifications`. Cuando vos como admin hacés un INSERT en esa tabla, Supabase empuja vía websocket al cliente del usuario suscripto. **Cero polling, cero consumo intermitente de Vercel.**

---

## 🚢 Deploy a Vercel

Cuando estés listo:

1. Pushear el repo a GitHub.
2. En Vercel → Import Project → seleccionar el repo.
3. Agregar las mismas variables de `.env.local` en Vercel (Settings → Environment Variables).
4. Deploy.

⚠️ **Importante:** marcá `SUPABASE_SERVICE_ROLE_KEY` como secret y NO la expongas como `NEXT_PUBLIC_*`.

---

## 📜 Licencia

Uso educativo interno. Plataforma con saldos simulados.
