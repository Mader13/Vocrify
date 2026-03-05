import * as React from "react";
import { useEffect, useRef, useCallback, useState, useMemo, useImperativeHandle, forwardRef } from "react";
import { List } from "react-window";

import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/utils";
import type { CompletedViewLayoutMode } from "@/components/features/completed-view-layout";
import type { TranscriptionSegment } from "@/types";

/**
 * Highlights search query in text
 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) {
    return text;
  }

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (regex.test(part)) {
      return (
        <mark key={index} className="bg-yellow-300/80 dark:bg-yellow-500/50 text-current rounded px-0.5">
          {part}
        </mark>
      );
    }
    return part;
  });
}

/**
 * Imperative handle exposed via ref
 */
export interface TranscriptionSegmentsHandle {
  scrollToActive: () => void;
}

/**
 * Props for the TranscriptionSegments component
 */
export interface TranscriptionSegmentsProps {
  /** Array of transcription segments to display */
  segments: TranscriptionSegment[];
  /** Current playback time in seconds */
  currentTime: number;
  /** Index of segment clicked by user (temporary selection lock) */
  selectedSegmentIndex?: number;
  /** Callback when a segment is clicked, receives the index and start time */
  onSegmentClick: (index: number, startTime: number) => void;
  /** Whether video player is visible (affects height) */
  isVideoVisible?: boolean;
  /** Layout mode for responsive height behavior */
  layoutMode?: CompletedViewLayoutMode;
  /** Search query to highlight in segments */
  searchQuery?: string;
  /** Index of the currently highlighted search result (for navigation) */
  highlightedSearchIndex?: number;
  /** Callback when search index changes */
  onScrollToSegment?: (index: number) => void;
}

/**
 * Props for an individual segment item
 */
interface SegmentItemProps {
  /** The segment data */
  segment: TranscriptionSegment;
  /** Whether this segment is currently active/playing */
  isActive: boolean;
  /** Click handler for the segment */
  onClick: () => void;
  /** Search query to highlight */
  searchQuery?: string;
  /** Whether this segment is the currently highlighted search result */
  isHighlighted?: boolean;
  /** Match index for this segment (e.g., "1/5") */
  matchIndex?: number;
  /** Total matches */
  totalMatches?: number;
}

/**
 * Renders a single transcription segment with speaker badge and text
 */
function SegmentItem({ segment, isActive, onClick, searchQuery, isHighlighted, matchIndex, totalMatches }: SegmentItemProps): React.JSX.Element {
  const hasMatch = searchQuery && (
    segment.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (segment.speaker && segment.speaker.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative cursor-pointer px-3 py-3 transition-colors duration-200 sm:px-5 sm:py-4",
        "flex gap-3 sm:gap-6",
        !isActive && "hover:bg-muted/40",
        isHighlighted && !isActive && "bg-accent/60"
      )}
    >
      {isActive && (
        <div
          className="absolute inset-0 bg-primary/10 sm:rounded-lg"
          aria-hidden
        />
      )}

      <div className="relative shrink-0 flex flex-col items-start gap-1 z-10 w-[50px] sm:w-[65px]">
        <div className={cn(
          "font-mono transition-colors duration-200 mt-0.5",
          isActive
            ? "text-primary text-[13px] font-bold sm:text-[15px]"
            : "text-muted-foreground/80 text-[12px] sm:text-sm font-medium"
        )}>
          {formatTime(segment.start)}
        </div>
        {hasMatch && matchIndex && totalMatches && (
          <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
            {matchIndex}/{totalMatches}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-w-0 z-10">
        {segment.speaker && (
          <span className={cn(
            "mb-1.5 inline-block rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase transition-colors duration-200",
            isActive
              ? "bg-primary/20 text-primary"
              : "bg-muted/60 text-muted-foreground"
          )}>
            {searchQuery ? highlightText(segment.speaker, searchQuery) : segment.speaker}
          </span>
        )}
        <p className={cn(
          "break-words leading-[1.7] transition-colors duration-200",
          isActive
            ? "text-foreground text-[14px] font-medium sm:text-base"
            : "text-foreground/75 text-[14px] sm:text-[15px]"
        )}>
          {searchQuery ? highlightText(segment.text, searchQuery) : segment.text}
        </p>
      </div>
    </div>
  );
}

/**
 * Props for virtualized segment row (custom props only)
 */
interface VirtualizedSegmentRowProps {
  /** The segments array */
  segments: TranscriptionSegment[];
  /** Index of the currently active segment */
  activeIndex: number;
  /** Callback when segment is clicked */
  onSegmentClick: (index: number, startTime: number) => void;
  /** Search query to highlight */
  searchQuery?: string;
  /** Array of indices that match the search query */
  matchingIndices?: number[];
  /** Current highlighted search result index */
  highlightedSearchIndex?: number;
}

/**
 * Virtualized segment row renderer for react-window
 * react-window automatically adds: ariaAttributes, index, style
 */
function VirtualizedSegmentRow(
  props: {
    ariaAttributes: {
      "aria-posinset": number;
      "aria-setsize": number;
      role: "listitem";
    };
    index: number;
    style: React.CSSProperties;
  } & VirtualizedSegmentRowProps
): React.JSX.Element {
  const { index, style, segments, activeIndex, onSegmentClick, searchQuery, matchingIndices, highlightedSearchIndex } = props;
  const segment = segments[index];
  const isActive = index === activeIndex;

  // Check if this segment is the currently highlighted search result
  const isHighlighted = highlightedSearchIndex !== undefined && matchingIndices?.[highlightedSearchIndex] === index;
  const matchedIndex = matchingIndices?.indexOf(index) ?? -1;
  const matchIndex = matchedIndex >= 0 ? matchedIndex + 1 : undefined;
  const totalMatches = matchingIndices?.length;

  return (
    <div style={style}>
      <SegmentItem
        segment={segment}
        isActive={isActive}
        onClick={() => onSegmentClick(index, segment.start)}
        searchQuery={searchQuery}
        isHighlighted={isHighlighted}
        matchIndex={matchIndex}
        totalMatches={totalMatches}
      />
    </div>
  );
}

/**
 * Component for displaying transcription segments with virtualization support.
 *
 * Features:
 * - React.memo for preventing unnecessary re-renders
 * - Virtualization via react-window for >200 segments
 * - Highlight active segment using React state for proper re-rendering
 * - Auto-scroll to active segment during playback
 * - Click on segment to seek video to start time
 * - Search and highlight matches in segments with navigation
 *
 * @param segments - Array of transcription segments
 * @param currentTime - Current playback time in seconds
 * @param onSegmentClick - Callback when segment is clicked
 * @param searchQuery - Optional search query to highlight
 * @param highlightedSearchIndex - Index of the currently highlighted search result
 * @param onScrollToSegment - Callback to scroll to a specific segment
 */
export const TranscriptionSegments = React.memo(
  forwardRef<TranscriptionSegmentsHandle, TranscriptionSegmentsProps>(
  ({
    segments,
    currentTime,
    selectedSegmentIndex,
    onSegmentClick,
    isVideoVisible = true,
    layoutMode = "stacked",
    searchQuery = "",
    highlightedSearchIndex,
    onScrollToSegment,
  }, ref): React.JSX.Element => {
    const scrollElementToCenter = useCallback((container: HTMLElement, element: HTMLElement) => {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const elementTop = container.scrollTop + (elementRect.top - containerRect.top);
      const centeredTop = elementTop - (container.clientHeight / 2) + (element.clientHeight / 2);

      container.scrollTo({
        top: Math.max(0, centeredTop),
        behavior: "smooth",
      });
    }, []);

    // Calculate matching segment indices based on search query
    const matchingIndices = useMemo(() => {
      if (!searchQuery.trim()) {
        return [];
      }
      const lowerQuery = searchQuery.toLowerCase();
      const matches: number[] = [];
      segments.forEach((segment, index) => {
        if (segment.text.toLowerCase().includes(lowerQuery) ||
          (segment.speaker && segment.speaker.toLowerCase().includes(lowerQuery))) {
          matches.push(index);
        }
      });
      return matches;
    }, [segments, searchQuery]);

    // Scroll to highlighted search result when it changes
    useEffect(() => {
      if (highlightedSearchIndex !== undefined && highlightedSearchIndex >= 0 && matchingIndices[highlightedSearchIndex] !== undefined) {
        const targetIndex = matchingIndices[highlightedSearchIndex];
        if (onScrollToSegment) {
          onScrollToSegment(targetIndex);
        }
      }
    }, [highlightedSearchIndex, matchingIndices, onScrollToSegment]);

    // Refs for segment DOM elements (used for auto-scrolling)
    const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
    // Ref for the container to check visibility
    const containerRef = useRef<HTMLDivElement>(null);
    // State for the currently active segment index (must be state to trigger re-render)
    const [activeIndex, setActiveIndex] = useState<number>(-1);
    // Ref for tracking the last scrolled-to segment to prevent redundant scrolling
    const lastScrolledIndexRef = useRef<number>(-1);
    // Ref to track if user is manually scrolling (to pause auto-scroll temporarily)
    const isUserScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Expose scrollToActive via ref so parent can trigger scroll to active segment
    useImperativeHandle(ref, () => ({
      scrollToActive: () => {
        if (activeIndex === -1) return;
        const container = containerRef.current;
        if (!container) return;
        const segmentEl = segmentRefs.current[activeIndex];
        if (segmentEl) {
          scrollElementToCenter(container, segmentEl);
        }
      },
    }), [activeIndex, scrollElementToCenter]);
    /**
     * Update active segment index based on current playback time
     */
    useEffect(() => {
      if (selectedSegmentIndex !== undefined && selectedSegmentIndex >= 0) {
        if (selectedSegmentIndex !== activeIndex) {
          setActiveIndex(selectedSegmentIndex);
        }
        return;
      }

      if (segments.length === 0) {
        if (activeIndex !== -1) {
          setActiveIndex(-1);
        }
        return;
      }

      const lastIndex = segments.length - 1;
      const isTimeInsideSegment = (index: number) => {
        if (index < 0 || index > lastIndex) return false;
        const segment = segments[index];
        if (!segment) return false;
        return index === lastIndex
          ? currentTime >= segment.start && currentTime <= segment.end
          : currentTime >= segment.start && currentTime < segment.end;
      };

      // Fast path: still inside current segment.
      if (activeIndex >= 0 && isTimeInsideSegment(activeIndex)) {
        return;
      }

      // Adjacent segment checks handle normal playback without scanning all segments.
      const nextIndex = activeIndex + 1;
      if (isTimeInsideSegment(nextIndex)) {
        setActiveIndex(nextIndex);
        return;
      }

      const previousIndex = activeIndex - 1;
      if (isTimeInsideSegment(previousIndex)) {
        setActiveIndex(previousIndex);
        return;
      }

      // Fallback for seeks/jumps: full scan.
      const newActiveIndex = segments.findIndex((_, index) => isTimeInsideSegment(index));

      if (newActiveIndex !== activeIndex) {
        setActiveIndex(newActiveIndex);
      }
    }, [currentTime, segments, activeIndex, selectedSegmentIndex]);

    /**
     * Check if element is visible in container
     */
    const isElementVisible = useCallback((element: HTMLElement, container: HTMLElement) => {
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      return (
        elementRect.top >= containerRect.top + 50 && // 50px buffer from top
        elementRect.bottom <= containerRect.bottom - 50 // 50px buffer from bottom
      );
    }, []);

    /**
     * Check if active segment has moved below the middle line of container.
     * While playback is running, we keep active segment at or above middle.
     */
    const isElementBelowMiddle = useCallback((element: HTMLElement, container: HTMLElement) => {
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const elementCenterY = (elementRect.top + elementRect.bottom) / 2;
      const containerMiddleY = (containerRect.top + containerRect.bottom) / 2;

      return elementCenterY > containerMiddleY;
    }, []);

    /**
     * Handle user scroll events to pause auto-scroll
     */
    const handleScroll = useCallback(() => {
      isUserScrollingRef.current = true;
      
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Resume auto-scroll after 2 seconds of no user interaction
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 2000);
    }, []);

    /**
     * Auto-scroll to the active segment when it changes
     */
    useEffect(() => {
      if (activeIndex === -1) {
        return;
      }

      // For non-virtualized list (<200 segments), scroll the DOM element
      if (segments.length <= 200) {
        const element = segmentRefs.current[activeIndex];
        const container = containerRef.current;

        if (element && container) {
          const belowMiddle = isElementBelowMiddle(element, container);
          const notVisible = !isElementVisible(element, container);
          const shouldScroll = belowMiddle || notVisible;
          const indexChanged = activeIndex !== lastScrolledIndexRef.current;
          const canAutoScroll = !isUserScrollingRef.current || belowMiddle;

          if (shouldScroll && canAutoScroll && (indexChanged || belowMiddle)) {
            scrollElementToCenter(container, element);
          }
        }
      }

      // For virtualized list, the List component handles scrolling internally
      lastScrolledIndexRef.current = activeIndex;
    }, [
      activeIndex,
      segments.length,
      isElementVisible,
      isElementBelowMiddle,
      scrollElementToCenter,
    ]);

    const shouldCapHeight = isVideoVisible && layoutMode === "stacked";

    /**
     * Render all segments without virtualization (<200 segments)
     */
    if (segments.length <= 200) {
      return (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onWheel={(e) => e.stopPropagation()}
          className={cn(
            "flex flex-col overflow-y-auto",
            shouldCapHeight ? "max-h-[44vh] sm:max-h-[400px]" : "h-full min-h-0"
          )}
        >
          {segments.map((segment, index) => {
            const isHighlighted = highlightedSearchIndex !== undefined && matchingIndices[highlightedSearchIndex] === index;
            const matchIndex = matchingIndices.indexOf(index) !== -1 ? matchingIndices.indexOf(index) + 1 : undefined;

            return (
              <div
                key={`${segment.start}-${index}`}
                data-segment-index={index}
                ref={(el) => {
                  segmentRefs.current[index] = el;
                }}
              >
                <SegmentItem
                  segment={segment}
                  isActive={index === activeIndex}
                  onClick={() => onSegmentClick(index, segment.start)}
                  searchQuery={searchQuery}
                  isHighlighted={isHighlighted}
                  matchIndex={matchIndex}
                  totalMatches={matchingIndices.length || undefined}
                />
              </div>
            );
          })}
        </div>
      );
    }

    /**
     * Render segments with virtualization (>200 segments)
     */
    const rowProps = {
      segments,
      activeIndex: activeIndex,
      onSegmentClick,
      searchQuery,
      matchingIndices,
      highlightedSearchIndex,
    };

    return (
      <div
        className={cn(shouldCapHeight ? "max-h-[44vh] sm:max-h-[400px]" : "h-full min-h-0")}
        onWheel={(e) => e.stopPropagation()}
      >
        <List
          rowCount={segments.length}
          rowHeight={80}
          rowComponent={VirtualizedSegmentRow}
          rowProps={rowProps}
          overscanCount={5}
          style={{ height: shouldCapHeight ? "44vh" : "100%" }}
        />
      </div>
    );
  })
);

TranscriptionSegments.displayName = "TranscriptionSegments";
