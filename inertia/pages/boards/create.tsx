import { Link, Form } from '@adonisjs/inertia/react'
import type React from 'react'

const BoardsCreate: React.FC = () => {
  return (
    <div className="form-container">
      <div>
        <h1>New Board</h1>
        <p>Create a new design canvas board</p>
      </div>

      <div>
        <Form route="boards.store">
          {({ errors }: { errors: Record<string, string> }) => (
            <>
              <div>
                <label htmlFor="title">Title</label>
                <input
                  type="text"
                  name="title"
                  id="title"
                  data-invalid={errors.title ? 'true' : undefined}
                />
                {errors.title && <div>{errors.title}</div>}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="button">
                  Create
                </button>
                <Link
                  route="boards.index"
                  className="button"
                  style={{ background: 'var(--color-gray-4)' }}
                >
                  Cancel
                </Link>
              </div>
            </>
          )}
        </Form>
      </div>
    </div>
  )
}

export default BoardsCreate
