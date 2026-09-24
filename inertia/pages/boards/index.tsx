import { Link, Form } from '@adonisjs/inertia/react'
import type React from 'react'

interface Board {
  id: number
  title: string
  slug: string
  createdAt: string | null
  updatedAt: string | null
}

const BoardsIndex: React.FC<{ boards: Board[] }> = ({ boards }) => {
  return (
    <div className="form-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Boards</h1>
        <Link route="boards.create" className="button">
          New Board
        </Link>
      </div>

      {boards.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '3rem 0' }}>
          No boards yet. Create your first board to get started.
        </p>
      ) : (
        <div className="cards">
          {boards.map((board) => (
            <div key={board.id} style={{ position: 'relative' }}>
              <Link route="boards.show" routeParams={{ id: String(board.id) }}>
                <h3>{board.title}</h3>
                <p>
                  Created {board.createdAt ? new Date(board.createdAt).toLocaleDateString() : ''}
                </p>
              </Link>
              <Form
                route="boards.destroy"
                routeParams={{ id: String(board.id) }}
                method="delete"
                style={{ position: 'absolute', top: '1rem', right: '1rem' }}
              >
                <button
                  type="submit"
                  className="button"
                  style={{ background: 'var(--color-destructive, #dc2626)', fontSize: '0.8rem' }}
                >
                  Delete
                </button>
              </Form>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default BoardsIndex
