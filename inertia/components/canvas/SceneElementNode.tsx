import { memo, useEffect, useState } from 'react'
import { Arrow, Ellipse, Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import type { SceneElement } from '@shared/scene'
import { resolveAssetUrl } from '~/lib/scene/geometry'
import { translate } from '~/i18n'

/**
 * Renderuje jeden element sceny. Memoizowany: re-render tylko gdy zmienia się
 * sam element (nie cała scena) — kluczowe dla 500 elementów.
 */
export interface ElementNodeProps {
  el: SceneElement
  isSelected: boolean
  listening: boolean
  registerNode: (id: string, node: Konva.Node | null) => void
  onSelect: (id: string, additive: boolean) => void
  onDragStart: (id: string) => void
  onDragEnd: (id: string, node: Konva.Node) => void
  onEdit?: (id: string) => void
}

type PointyElement = Extract<SceneElement, { points: { x: number; y: number }[] }>

function toFlatPoints(el: PointyElement): number[] {
  return el.points.flatMap((p) => [p.x, p.y])
}

/** Ładuje obraz z URL (bez dodatkowej zależności react-konva-utils). */
function useLoadedImage(url: string) {
  const [state, setState] = useState<{
    image: HTMLImageElement | null
    status: 'loading' | 'loaded' | 'failed'
  }>({
    image: null,
    status: 'loading',
  })
  useEffect(() => {
    let cancelled = false
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!cancelled) setState({ image: img, status: 'loaded' })
    }
    img.onerror = () => {
      if (!cancelled) setState({ image: null, status: 'failed' })
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])
  return state
}

function ImageNode({
  el,
  isSelected,
  listening,
  registerNode,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  el: Extract<SceneElement, { type: 'image' }>
} & Omit<ElementNodeProps, 'el'>) {
  const url = resolveAssetUrl(el.assetId)
  const { image, status } = useLoadedImage(url)

  const common = {
    id: el.id,
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: el.opacity,
    listening,
    draggable: isSelected,
    onClick: (e: any) => {
      e.cancelBubble = true
      onSelect(el.id, e.evt.shiftKey)
    },
    onTap: () => onSelect(el.id, false),
    onDragStart: () => onDragStart(el.id),
    onDragEnd: (e: any) => onDragEnd(el.id, e.target),
    ref: (node: Konva.Node | null) => registerNode(el.id, node),
  }

  if (status === 'loaded' && image) {
    return <KonvaImage {...common} image={image} width={el.width} height={el.height} />
  }

  // Placeholder, gdy asset nie istnieje lub nie ma podglądu (np. PDF/plik).
  return (
    <Group {...common}>
      <Rect
        width={el.width}
        height={el.height}
        fill="#f4f1ec"
        stroke="#d1d1cd"
        strokeWidth={1}
        dash={[4, 4]}
        cornerRadius={8}
      />
      <Text
        text={translate('canvas.noPreview')}
        x={8}
        y={el.height / 2 - 8}
        width={el.width - 16}
        align="center"
        fontSize={12}
        fill="#92918b"
        listening={false}
      />
    </Group>
  )
}

function StickyNode({
  el,
  isSelected,
  listening,
  registerNode,
  onSelect,
  onDragStart,
  onDragEnd,
  onEdit,
}: {
  el: Extract<SceneElement, { type: 'sticky' }>
} & Omit<ElementNodeProps, 'el'>) {
  return (
    <Group
      id={el.id}
      x={el.x}
      y={el.y}
      rotation={el.rotation}
      opacity={el.opacity}
      listening={listening}
      draggable={isSelected}
      onClick={(e: any) => {
        e.cancelBubble = true
        onSelect(el.id, e.evt.shiftKey)
      }}
      onTap={() => onSelect(el.id, false)}
      onDragStart={() => onDragStart(el.id)}
      onDragEnd={(e: any) => onDragEnd(el.id, e.target)}
      onDblClick={() => onEdit?.(el.id)}
      onDblTap={() => onEdit?.(el.id)}
      ref={(node) => registerNode(el.id, node)}
    >
      <Rect
        width={el.width}
        height={el.height}
        fill={el.fill}
        stroke="rgba(39,37,30,0.1)"
        strokeWidth={1}
        shadowColor="rgba(0,0,0,0.12)"
        shadowBlur={3}
        shadowOffsetY={1}
        cornerRadius={6}
      />
      <Text
        text={el.text}
        width={el.width - 24}
        x={12}
        y={12}
        fontSize={el.fontSize ?? 14}
        lineHeight={1.4}
        fontFamily="'Inter Variable', Inter, system-ui, sans-serif"
        fill="#27251e"
        listening={false}
      />
    </Group>
  )
}

function ElementNodeInner(props: ElementNodeProps) {
  const { el, ...rest } = props

  switch (el.type) {
    case 'rectangle':
      return (
        <Rect
          id={el.id}
          x={el.x}
          y={el.y}
          width={el.width}
          height={el.height}
          rotation={el.rotation}
          opacity={el.opacity}
          fill={el.fill}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          cornerRadius={el.cornerRadius ?? 0}
          listening={props.listening}
          draggable={props.isSelected}
          onClick={(e: any) => {
            e.cancelBubble = true
            props.onSelect(el.id, e.evt.shiftKey)
          }}
          onTap={() => props.onSelect(el.id, false)}
          onDragStart={() => props.onDragStart(el.id)}
          onDragEnd={(e: any) => props.onDragEnd(el.id, e.target)}
          ref={(node) => props.registerNode(el.id, node)}
        />
      )
    case 'ellipse':
      return (
        <Ellipse
          id={el.id}
          x={el.x}
          y={el.y}
          // x/y elementu to lewy górny róg (jak w bounds i u prostokąta), a Konva
          // rysuje elipsę od środka — przesuwamy ją ujemnym offsetem.
          offsetX={-el.width / 2}
          offsetY={-el.height / 2}
          width={el.width}
          height={el.height}
          rotation={el.rotation}
          opacity={el.opacity}
          fill={el.fill}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          listening={props.listening}
          draggable={props.isSelected}
          onClick={(e: any) => {
            e.cancelBubble = true
            props.onSelect(el.id, e.evt.shiftKey)
          }}
          onTap={() => props.onSelect(el.id, false)}
          onDragStart={() => props.onDragStart(el.id)}
          onDragEnd={(e: any) => props.onDragEnd(el.id, e.target)}
          ref={(node) => props.registerNode(el.id, node)}
        />
      )
    case 'line':
      return (
        <Line
          id={el.id}
          x={el.x}
          y={el.y}
          rotation={el.rotation}
          opacity={el.opacity}
          points={toFlatPoints(el)}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={props.listening}
          draggable={props.isSelected}
          onClick={(e: any) => {
            e.cancelBubble = true
            props.onSelect(el.id, e.evt.shiftKey)
          }}
          onTap={() => props.onSelect(el.id, false)}
          onDragStart={() => props.onDragStart(el.id)}
          onDragEnd={(e: any) => props.onDragEnd(el.id, e.target)}
          ref={(node) => props.registerNode(el.id, node)}
        />
      )
    case 'arrow':
      return (
        <Arrow
          id={el.id}
          x={el.x}
          y={el.y}
          rotation={el.rotation}
          opacity={el.opacity}
          points={toFlatPoints(el)}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          pointerLength={el.arrowHeadSize ?? 10}
          pointerWidth={el.arrowHeadSize ?? 10}
          fill={el.stroke}
          listening={props.listening}
          draggable={props.isSelected}
          onClick={(e: any) => {
            e.cancelBubble = true
            props.onSelect(el.id, e.evt.shiftKey)
          }}
          onTap={() => props.onSelect(el.id, false)}
          onDragStart={() => props.onDragStart(el.id)}
          onDragEnd={(e: any) => props.onDragEnd(el.id, e.target)}
          ref={(node) => props.registerNode(el.id, node)}
        />
      )
    case 'freehand':
      return (
        <Line
          id={el.id}
          x={el.x}
          y={el.y}
          rotation={el.rotation}
          opacity={el.opacity}
          points={toFlatPoints(el)}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={props.listening}
          draggable={props.isSelected}
          onClick={(e: any) => {
            e.cancelBubble = true
            props.onSelect(el.id, e.evt.shiftKey)
          }}
          onTap={() => props.onSelect(el.id, false)}
          onDragStart={() => props.onDragStart(el.id)}
          onDragEnd={(e: any) => props.onDragEnd(el.id, e.target)}
          ref={(node) => props.registerNode(el.id, node)}
        />
      )
    case 'text':
      return (
        <Text
          id={el.id}
          x={el.x}
          y={el.y}
          rotation={el.rotation}
          opacity={el.opacity}
          text={el.text}
          fontSize={el.fontSize}
          fontFamily={el.fontFamily}
          fill={el.fill}
          width={el.width}
          align={el.align}
          listening={props.listening}
          draggable={props.isSelected}
          onClick={(e: any) => {
            e.cancelBubble = true
            props.onSelect(el.id, e.evt.shiftKey)
          }}
          onTap={() => props.onSelect(el.id, false)}
          onDragStart={() => props.onDragStart(el.id)}
          onDragEnd={(e: any) => props.onDragEnd(el.id, e.target)}
          onDblClick={() => props.onEdit?.(el.id)}
          onDblTap={() => props.onEdit?.(el.id)}
          ref={(node) => props.registerNode(el.id, node)}
        />
      )
    case 'sticky':
      return <StickyNode el={el} {...rest} />
    case 'image':
      return <ImageNode el={el} {...rest} />
  }
}

export const SceneElementNode = memo(ElementNodeInner)
