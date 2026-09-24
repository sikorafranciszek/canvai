import { Link } from '@adonisjs/inertia/react'
import type React from 'react'

interface Board {
  id: number
  title: string
  slug: string
  createdAt: string | null
  updatedAt: string | null
}

const BoardsShow: React.FC<{ board: Board }> = ({ board }) => {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 2rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ margin: 0 }}>{board.title}</h1>
        </div>
        <Link route="boards.index" className="button">
          Back to Boards
        </Link>
      </div>

      <div
        style={{
          margin: '0 2rem',
          border: '2px dashed var(--color-gray-6, #d1d5db)',
          borderRadius: '12px',
          minHeight: '70vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-gray-2, #f9fafb)',
        }}
      >
        <p style={{ color: 'var(--color-gray-9, #6b7280)' }}>
          Canvas placeholder — drag and drop assets here
        </p>
      </div>
    </div>
  )
}

export default BoardsShow
