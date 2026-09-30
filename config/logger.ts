import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, syncDestination, targets } from '@adonisjs/core/logger'

const loggerConfig = defineConfig({
  /**
   * Default logger name used by ctx.logger and app logger calls.
   */
  default: 'app',

  loggers: {
    app: {
      /**
       * Toggle this logger on/off.
       */
      enabled: true,

      /**
       * Logger name shown in log records.
       */
      name: env.get('APP_NAME'),

      /**
       * Minimum level to output (trace, debug, info, warn, error, fatal).
       */
      level: env.get('LOG_LEVEL'),

      /**
       * Kopia logów (info+) do ClickHouse (tabela `logs`) — odbiorcę ustawia
       * preload `start/analytics.ts`; bez niego hook nic nie robi.
       */
      hooks: {
        logMethod(args, method, level) {
          const sink = (globalThis as any).__canvaiLogSink as
            | ((level: number, args: unknown[], bindings: Record<string, unknown>) => void)
            | undefined
          if (sink && level >= 30) {
            try {
              sink(level, args, (this as any).bindings?.() ?? {})
            } catch {
              // Analityka nigdy nie może zablokować logowania.
            }
          }
          return method.apply(this, args as Parameters<typeof method>)
        },
      },

      /**
       * Use sync destination in non-production for immediate flush.
       */
      destination: !app.inProduction ? await syncDestination() : undefined,

      /**
       * Configure where logs are written.
       */
      transport: {
        targets: [targets.file({ destination: 1 })],
      },
    },
  },
})

export default loggerConfig

/**
 * Inferring types for the list of loggers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
