import { useState, useMemo, useCallback, useEffect } from "react";
import { useI18n } from "@/hooks";
import { Archive, Trash2, Search, Calendar, ArrowUpDown, X, ChevronLeft, ChevronRight, Sparkles, FolderOpen, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatFileSize, formatDateTime } from "@/lib/utils";
import { useArchivedTasks, useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask } from "@/types";
import { ExportMenu } from "@/components/features/ExportMenu";
import { ArchiveCleanupModal } from "./ArchiveCleanupModal";
import { openArchiveFolder } from "@/services/tauri";

type SortOption = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
const TABLE_COLUMN_COUNT = 4;

export function ArchiveView() {
  const { t } = useI18n();
  const archivedTasks = useArchivedTasks();
  const removeTask = useTasks((s) => s.removeTask);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("date-desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  const getArchivedSize = (task: TranscriptionTask): number => task.archiveSize ?? task.fileSize;

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isValidDate = (dateString: string): boolean => {
    if (!dateString) return true;
    const date = new Date(dateString);
    return !isNaN(date.getTime());
  };

  const filteredAndSortedTasks = useMemo(() => {
    let result = [...archivedTasks];

    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      result = result.filter((task) =>
        task.fileName.toLowerCase().includes(query)
      );
    }

    if (dateFrom && isValidDate(dateFrom)) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      result = result.filter((task) => new Date(task.createdAt) >= fromDate);
    }
    if (dateTo && isValidDate(dateTo)) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter((task) => new Date(task.createdAt) <= toDate);
    }

    result.sort((a, b) => {
      const [field, order] = sortOption.split("-") as ["date" | "name", "asc" | "desc"];
      let comparison = 0;
      if (field === "name") {
        comparison = a.fileName.localeCompare(b.fileName);
      } else {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        comparison = dateA - dateB;
      }
      return order === "asc" ? comparison : -comparison;
    });

    return result;
  }, [archivedTasks, debouncedSearchQuery, sortOption, dateFrom, dateTo]);

  const totalArchivedSize = useMemo(
    () => archivedTasks.reduce((sum, task) => sum + getArchivedSize(task), 0),
    [archivedTasks]
  );

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedTasks.length / itemsPerPage);
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedTasks.slice(start, start + itemsPerPage);
  }, [filteredAndSortedTasks, currentPage, itemsPerPage]);

  // Reset page when filters change
  const handleFilterChange = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setCurrentPage(1);
  };

  const handleTaskClick = (taskId: string) => {
    setSelectedTask(taskId);
    setCurrentView("transcription");
  };

  const handleDeleteClick = useCallback((taskId: string) => {
    setTaskToDelete(taskId);
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (taskToDelete) {
      removeTask(taskToDelete);
      setTaskToDelete(null);
      setDeleteDialogOpen(false);
    }
  }, [taskToDelete, removeTask]);

  const handleOpenArchiveFolder = async () => {
    const result = await openArchiveFolder();
    if (!result.success) {
      console.error("Failed to open archive folder:", result.error);
    }
  };

  if (archivedTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] h-full text-center p-8 animate-in fade-in-0 zoom-in-95 bg-card/60 dark:bg-card/30 backdrop-blur-md border border-border/50 dark:border-white/5 rounded-2xl m-4">
        <div className="rounded-full bg-background/80 dark:bg-white/5 border border-border/50 dark:border-white/10 p-5 mb-5 shadow-sm">
          <Archive className="h-10 w-10 text-muted-foreground/70" />
        </div>
        <h2 className="text-xl font-semibold mb-2 text-foreground">{t("archive.empty")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">
          {t("archive.emptyDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 overflow-y-auto h-full">
      {/* Header and count */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-background/80 dark:bg-background/40 backdrop-blur-sm border border-border/50 dark:border-white/10 rounded-full">
            <Archive className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              {filteredAndSortedTasks.length.toLocaleString()}{" "}
              <span className="text-muted-foreground font-normal">{t("archive.videosArchived")}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-background/80 dark:bg-background/40 backdrop-blur-sm border border-border/50 dark:border-white/10 rounded-full">
            <span className="text-sm font-medium text-foreground">
              {formatFileSize(totalArchivedSize)}{" "}
              <span className="text-muted-foreground font-normal">{t("archive.used")}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenArchiveFolder}
            className="h-8 gap-1.5 bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20"
          >
            <FolderOpen className="h-4 w-4" />
            {t("archive.openFolder")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCleanupModalOpen(true)}
            className="h-8 gap-1.5 bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20"
          >
            <Sparkles className="h-4 w-4" />
            {t("archive.cleanup")}
          </Button>
        </div>
      </div>

      {/* Filters and sorting panel */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 bg-card/60 dark:bg-card/30 backdrop-blur-md border border-border/50 dark:border-white/5 rounded-2xl">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("archive.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => handleFilterChange(setSearchQuery)(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-background/50 dark:bg-black/20 border border-border/50 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => handleFilterChange(setSearchQuery)("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Date filters and sorting */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date from filter */}
          <div className="flex items-center gap-2 bg-background/50 dark:bg-black/20 border border-border/50 dark:border-white/10 rounded-lg px-2 py-1 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
              className="w-[120px] bg-transparent border-none text-sm focus:outline-none text-foreground dark:[color-scheme:dark]"
              title={t("archive.fromDate")}
            />
          </div>

          <span className="text-muted-foreground/50 text-sm">-</span>

          {/* Date to filter */}
          <div className="flex items-center gap-2 bg-background/50 dark:bg-black/20 border border-border/50 dark:border-white/10 rounded-lg px-2 py-1 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
              className="w-[120px] bg-transparent border-none text-sm focus:outline-none text-foreground dark:[color-scheme:dark]"
              title={t("archive.toDate")}
            />
          </div>

          {/* Sorting */}
          <div className="flex items-center gap-2 bg-background/50 dark:bg-black/20 border border-border/50 dark:border-white/10 rounded-lg px-2 py-1 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              value={sortOption}
              onChange={(e) => {
                setSortOption(e.target.value as SortOption);
                setCurrentPage(1);
              }}
              className="bg-transparent border-none text-sm focus:outline-none w-auto min-w-[130px] text-foreground dark:[color-scheme:dark]"
            >
              <option value="date-desc">{t("archive.newestFirst")}</option>
              <option value="date-asc">{t("archive.oldestFirst")}</option>
              <option value="name-asc">{t("archive.nameAZ")}</option>
              <option value="name-desc">{t("archive.nameZA")}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Archived tasks table container */}
      <div className="flex-1 bg-card/60 dark:bg-card/30 backdrop-blur-md border border-border/50 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm flex flex-col min-h-[400px]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 dark:bg-black/20 border-b border-border/50 dark:border-white/5">
              <tr>
                <th className="text-left py-3.5 px-5 font-medium text-muted-foreground">{t("archive.fileName")}</th>
                <th className="text-left py-3.5 px-5 font-medium text-muted-foreground w-28">{t("archive.archivedSize")}</th>
                <th className="text-left py-3.5 px-5 font-medium text-muted-foreground w-40">{t("archive.dateAdded")}</th>
                <th className="text-right py-3.5 px-5 font-medium text-muted-foreground w-32">{t("archive.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTasks.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLUMN_COUNT} className="py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Search className="h-8 w-8 text-muted-foreground/50" />
                      <p>{t("common.noResults")}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedTasks.map((task, index) => (
                  <tr
                    key={task.id}
                    className="border-b border-border/30 dark:border-white/5 last:border-b-0 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition-colors animate-in fade-in-0 slide-in-from-bottom-2 group"
                    style={{ animationDelay: `${index * 20}ms` }}
                    onClick={() => handleTaskClick(task.id)}
                  >
                    <td className="py-4 px-5">
                      <span className="font-medium truncate max-w-[200px] sm:max-w-[300px] lg:max-w-[400px] xl:max-w-[600px] group-hover:text-foreground transition-colors" title={task.fileName}>
                        {task.fileName}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-muted-foreground whitespace-nowrap">
                      {formatFileSize(getArchivedSize(task))}
                    </td>
                    <td className="py-4 px-5 text-muted-foreground whitespace-nowrap">
                      {formatDateTime(task.createdAt)}
                    </td>
                    <td className="py-4 px-5 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <ExportMenu task={task} iconOnly />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(task.id);
                          }}
                          title={t("archive.deletePermanently")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("archive.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("archive.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
                {t("common.cancel")}
              </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pagination */}
      {filteredAndSortedTasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 py-2 px-1">
          {/* Items per page */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("common.show")}</span>
            <div className="relative border border-border/50 dark:border-white/10 rounded-md bg-transparent focus-within:ring-1 focus-within:ring-primary/50 transition-all">
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-8 pl-2 pr-6 py-1 bg-transparent border-none text-sm focus:outline-none appearance-none text-foreground dark:[color-scheme:dark]"
              >
                {ITEMS_PER_PAGE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                <ArrowUpDown className="h-3 w-3 text-muted-foreground opacity-50" />
              </div>
            </div>
            <span>{t("common.perPage")}</span>
          </div>

          <div className="flex items-center gap-4">
            {/* Records info */}
            <div className="text-sm text-muted-foreground hidden sm:block">
              {filteredAndSortedTasks.length > 0 && (
                <>
                  {(currentPage - 1) * itemsPerPage + 1}–
                  {Math.min(currentPage * itemsPerPage, filteredAndSortedTasks.length)} {t("common.of")}{" "}
                  {filteredAndSortedTasks.length}
                </>
              )}
            </div>

            {/* Page navigation */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 bg-card/60 dark:bg-card/30 backdrop-blur-md border-border/50 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <span className="text-sm font-medium px-2 text-foreground">
                {currentPage} <span className="text-muted-foreground font-normal">/ {totalPages || 1}</span>
              </span>

              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 bg-card/60 dark:bg-card/30 backdrop-blur-md border-border/50 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <ArchiveCleanupModal
        tasks={archivedTasks}
        isOpen={isCleanupModalOpen}
        onClose={() => setIsCleanupModalOpen(false)}
      />
    </div>
  );
}
