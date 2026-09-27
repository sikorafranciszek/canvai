import { test } from '@japa/runner'
import {
  completeUpload,
  createPendingUpload,
  resolveUploadResult,
  setUploadProgress,
  uploadToImageElement,
  type PendingUpload,
} from '#shared/upload-state'

function upload(): PendingUpload {
  return createPendingUpload({
    id: 'u1',
    source: 'paste',
    filename: 'screen.png',
    x: 10,
    y: 20,
  })
}

test.group('Cykl życia uploadu (upload-state)', () => {
  test('createPendingUpload — placeholder z domyślnymi wymiarami i postępem 0', ({ assert }) => {
    const u = upload()
    assert.equal(u.status, 'uploading')
    assert.equal(u.progress, 0)
    assert.equal(u.x, 10)
    assert.equal(u.y, 20)
    assert.isNull(u.asset)
    assert.isNull(u.error)
  })

  test('setUploadProgress — ogranicza postęp do 0..1', ({ assert }) => {
    assert.equal(setUploadProgress(upload(), 0.5).progress, 0.5)
    assert.equal(setUploadProgress(upload(), 1.4).progress, 1)
    assert.equal(setUploadProgress(upload(), -0.2).progress, 0)
  })

  test('completeUpload — przyjmuje wymiary assetu', ({ assert }) => {
    const u = completeUpload(upload(), { id: '42', width: 800, height: 600 })
    assert.equal(u.status, 'done')
    assert.equal(u.progress, 1)
    assert.equal(u.width, 800)
    assert.equal(u.height, 600)
  })

  test('resolveUploadResult (sukces) — usuwa placeholder i zwraca element image', ({ assert }) => {
    const result = resolveUploadResult([upload()], 'u1', {
      ok: true,
      asset: { id: '42', width: 800, height: 600 },
      elementId: 'el-1',
    })

    assert.lengthOf(result.pendingUploads, 0)
    assert.isNull(result.error)
    assert.isNotNull(result.addedElement)
    assert.equal(result.addedElement!.type, 'image')
    assert.equal(result.addedElement!.assetId, '42')
    assert.equal(result.addedElement!.id, 'el-1')
    assert.equal(result.addedElement!.x, 10)
    assert.equal(result.addedElement!.y, 20)
  })

  test('resolveUploadResult (błąd) — rollback: bez sieroty na płótnie i w panelu', ({ assert }) => {
    const result = resolveUploadResult([upload()], 'u1', { ok: false, error: 'plik za duży' })

    assert.lengthOf(result.pendingUploads, 0)
    assert.isNull(result.addedElement)
    assert.equal(result.error, 'plik za duży')
  })

  test('resolveUploadResult — nieznany uploadId nic nie zmienia', ({ assert }) => {
    const pending = [upload()]
    const result = resolveUploadResult(pending, 'nieznany', { ok: false, error: 'x' })

    assert.lengthOf(result.pendingUploads, 1)
    assert.isNull(result.addedElement)
    assert.isNull(result.error)
  })

  test('uploadToImageElement — null, gdy upload nie jest done', ({ assert }) => {
    assert.isNull(uploadToImageElement(upload(), 'el-1'))
  })
})
