import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type TechnicalInspectionItem = {
  readonly label: string;
  readonly value: string;
};

export type TechnicalInspectionBlock = {
  readonly id: string;
  readonly title: string;
  readonly items: readonly TechnicalInspectionItem[];
};

type TechnicalInspectionContextValue = {
  readonly blocks: readonly TechnicalInspectionBlock[];
  readonly upsertBlock: (block: TechnicalInspectionBlock) => void;
  readonly unregisterBlock: (blockId: string) => void;
};

const TechnicalInspectionContext = createContext<TechnicalInspectionContextValue | null>(null);

const blocksEqual = (left: TechnicalInspectionBlock, right: TechnicalInspectionBlock): boolean =>
  left.id === right.id &&
  left.title === right.title &&
  left.items.length === right.items.length &&
  left.items.every(
    (item, index) =>
      item.label === right.items[index]?.label && item.value === right.items[index]?.value,
  );

export const TechnicalInspectionProvider = ({ children }: { readonly children: ReactNode }) => {
  const [blocks, setBlocks] = useState<readonly TechnicalInspectionBlock[]>([]);

  const upsertBlock = useCallback((block: TechnicalInspectionBlock) => {
    setBlocks((current) => {
      const index = current.findIndex((candidate) => candidate.id === block.id);
      if (index < 0) return [...current, block];
      if (blocksEqual(current[index]!, block)) return current;
      return current.map((candidate, candidateIndex) =>
        candidateIndex === index ? block : candidate,
      );
    });
  }, []);

  const unregisterBlock = useCallback((blockId: string) => {
    setBlocks((current) => {
      const next = current.filter((block) => block.id !== blockId);
      return next.length === current.length ? current : next;
    });
  }, []);

  const value = useMemo(
    () => ({ blocks, upsertBlock, unregisterBlock }),
    [blocks, unregisterBlock, upsertBlock],
  );

  return (
    <TechnicalInspectionContext.Provider value={value}>
      {children}
    </TechnicalInspectionContext.Provider>
  );
};

export const useTechnicalInspection = (): TechnicalInspectionContextValue => {
  const context = useContext(TechnicalInspectionContext);
  if (!context) {
    throw new Error('useTechnicalInspection must be used inside TechnicalInspectionProvider.');
  }
  return context;
};

export const useOptionalTechnicalInspection = (): TechnicalInspectionContextValue | null =>
  useContext(TechnicalInspectionContext);
