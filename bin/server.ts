/*
|--------------------------------------------------------------------------
| HTTP server entrypoint
|--------------------------------------------------------------------------
|
| The "server.ts" file is the entrypoint for starting the AdonisJS HTTP
| server. Either you can run this file directly or use the "serve"
| command to run this file and monitor file changes
|
*/

/**
 * Znacznik procesu serwera HTTP: worker kolejki i harmonogram (start/worker.ts)
 * startują tylko tutaj — nie w poleceniach ace (`codegen`/`build` w obrazie
 * Dockera bootują aplikację w trybie web i zawisały na otwartej bazie).
 */
process.env.CANVAI_HTTP_SERVER = '1'

await import('reflect-metadata')
const { Ignitor, prettyPrintError } = await import('@adonisjs/core/ignitor')

/**
 * URL to the application root. AdonisJS need it to resolve
 * paths to file and directories for scaffolding commands
 */
const APP_ROOT = new URL('../', import.meta.url)

/**
 * The importer is used to import files in context of the
 * application.
 */
const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

new Ignitor(APP_ROOT, { importer: IMPORTER })
  .tap((app) => {
    app.booting(async () => {
      await import('#start/env')
    })
    // REL-3: tylko serwer HTTP (nie polecenia ace przy budowaniu obrazu).
    app.booted(async () => {
      const { assertProductionConfig } = await import('#start/production_checks')
      assertProductionConfig()
    })
    app.listen('SIGTERM', () => app.terminate())
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate())
  })
  .httpServer()
  .start()
  .catch(async (error) => {
    await prettyPrintError(error)
    // Otwarte połączenia (baza, timery) nie mogą trzymać procesu, który nie wystartował.
    process.exit(1)
  })
