import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { createSelectionState } from '../selection-state';
import type { IGraphData, IGraphEdge, IGraphNode } from '../graph-layout';

function edge(id: string, from: string, to: string): IGraphEdge {
  return { id, from, to, kind: 'references', confidence: 0.6 };
}

function node(id: string): IGraphNode {
  return {
    id,
    path: id,
    view: {} as IGraphNode['view'],
    kind: 'agent',
    position: { x: 0, y: 0 },
    stats: { linksIn: 0, linksOut: 0 },
    summary: {} as IGraphNode['summary'],
  };
}

function makeGraph(): IGraphData {
  // a-b-c, d isolated.
  return {
    nodes: [node('a'), node('b'), node('c'), node('d')],
    edges: [edge('e:ab', 'a', 'b'), edge('e:bc', 'b', 'c')],
  };
}

describe('selection-state', () => {
  it('no selection: every node is unselected, unhighlighted, undimmed', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>(null),
        activeTagSelection: signal<string | null>(null),
      });
      for (const id of ['a', 'b', 'c', 'd']) {
        expect(handle.isSelected(id)).toBe(false);
        expect(handle.isHighlighted(id)).toBe(false);
        expect(handle.isDimmed(id)).toBe(false);
      }
    });
  });

  it('self-selection: selected node is selected, never highlighted or dimmed', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isSelected('b')).toBe(true);
      expect(handle.isHighlighted('b')).toBe(false);
      expect(handle.isDimmed('b')).toBe(false);
    });
  });

  it('neighbour: highlighted true, dimmed false', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isHighlighted('a')).toBe(true);
      expect(handle.isHighlighted('c')).toBe(true);
      expect(handle.isDimmed('a')).toBe(false);
      expect(handle.isDimmed('c')).toBe(false);
    });
  });

  it('non-neighbour: highlighted false, dimmed true', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isHighlighted('d')).toBe(false);
      expect(handle.isDimmed('d')).toBe(true);
      // Unreachable from the focus: beyond the near ring.
      expect(handle.isFar('d')).toBe(true);
    });
  });

  it('grades the focus by hop distance: ring at 1, near dim at 2, far at 3+', () => {
    TestBed.runInInjectionContext(() => {
      // a-b-c-d-e chain, select a.
      const graph: IGraphData = {
        nodes: [node('a'), node('b'), node('c'), node('d'), node('e')],
        edges: [edge('e:ab', 'a', 'b'), edge('e:bc', 'b', 'c'), edge('e:cd', 'c', 'd'), edge('e:de', 'd', 'e')],
      };
      const handle = createSelectionState({
        graph: signal(graph),
        selectedNodeId: signal<string | null>('a'),
        activeTagSelection: signal<string | null>(null),
      });
      const view = handle.selectionView();
      expect(view.get('b')).toEqual({ selected: false, highlighted: true, dimmed: false, far: false });
      expect(view.get('c')).toEqual({ selected: false, highlighted: false, dimmed: true, far: false });
      expect(view.get('d')).toEqual({ selected: false, highlighted: false, dimmed: true, far: true });
      expect(view.get('e')).toEqual({ selected: false, highlighted: false, dimmed: true, far: true });
      // Edges follow their farther endpoint: inside the ring stays lit,
      // into the near ring dims, beyond it goes far.
      const edges = handle.edgeSelectionView();
      expect(edges.get('e:ab')).toMatchObject({ highlighted: true, dimmed: false, far: false });
      expect(edges.get('e:bc')).toMatchObject({ dimmed: true, far: false, opacity: 0.3 });
      expect(edges.get('e:cd')).toMatchObject({ dimmed: true, far: true, opacity: 0.12 });
    });
  });

  it('activity focus: executing nodes are the origins while nothing is selected', () => {
    TestBed.runInInjectionContext(() => {
      const graph: IGraphData = {
        nodes: [node('a'), node('b'), node('c'), node('d')],
        edges: [edge('e:ab', 'a', 'b'), edge('e:bc', 'b', 'c'), edge('e:cd', 'c', 'd')],
      };
      const selected = signal<string | null>(null);
      const focus = signal<ReadonlySet<string>>(new Set(['a']));
      const handle = createSelectionState({
        graph: signal(graph),
        selectedNodeId: selected,
        activeTagSelection: signal<string | null>(null),
        activityFocus: focus,
      });
      let view = handle.selectionView();
      // No selection ring on activity focus: neighbours stay plain.
      expect(view.get('a')).toEqual({ selected: false, highlighted: false, dimmed: false, far: false });
      expect(view.get('b')).toEqual({ selected: false, highlighted: false, dimmed: false, far: false });
      expect(view.get('c')).toEqual({ selected: false, highlighted: false, dimmed: true, far: false });
      expect(view.get('d')).toEqual({ selected: false, highlighted: false, dimmed: true, far: true });

      // A selection is the operator's own focus and wins over the activity.
      selected.set('d');
      view = handle.selectionView();
      expect(view.get('c')?.highlighted).toBe(true);
      expect(view.get('a')?.far).toBe(true);

      // Focus gone (follow off / activity ended): nothing dims.
      selected.set(null);
      focus.set(new Set());
      view = handle.selectionView();
      for (const id of ['a', 'b', 'c', 'd']) {
        expect(view.get(id)?.dimmed).toBe(false);
      }
    });
  });

  it('tag-selection active: dim is suspended for every node', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>('planning'),
      });
      expect(handle.isDimmed('d')).toBe(false);
      expect(handle.isEdgeDimmed(edge('e:ab', 'a', 'b'))).toBe(false);
    });
  });

  it('edge predicates honour selected endpoint', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('a'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isEdgeHighlighted(edge('e:ab', 'a', 'b'))).toBe(true);
      expect(handle.isEdgeHighlighted(edge('e:bc', 'b', 'c'))).toBe(false);
      expect(handle.isEdgeDimmed(edge('e:ab', 'a', 'b'))).toBe(false);
      expect(handle.isEdgeDimmed(edge('e:bc', 'b', 'c'))).toBe(true);
    });
  });

  it('edgeSelectionView bundles highlight / dim / opacity per edge id', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('a'),
        activeTagSelection: signal<string | null>(null),
      });
      const view = handle.edgeSelectionView();
      // e:ab touches the selected node 'a': highlighted, not dimmed,
      // opacity from the confidence gradient (0.25 + 0.75 * 0.6 = 0.7).
      expect(view.get('e:ab')).toEqual({ highlighted: true, dimmed: false, far: false, opacity: 0.7 });
      // e:bc leads into the near ring (c is two hops from 'a'): dimmed,
      // the near-ring fade opacity, not yet far.
      expect(view.get('e:bc')).toEqual({ highlighted: false, dimmed: true, far: false, opacity: 0.3 });
    });
  });

  it('edgeSelectionView: no selection leaves every edge at its confidence opacity', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>(null),
        activeTagSelection: signal<string | null>(null),
      });
      const view = handle.edgeSelectionView();
      for (const id of ['e:ab', 'e:bc']) {
        expect(view.get(id)).toEqual({ highlighted: false, dimmed: false, far: false, opacity: 0.7 });
      }
    });
  });
});
