import { useState, useMemo } from "react";
import { Archive, Trash2, Search, Calendar, ArrowUpDown, X, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize, formatDateTime } from "@/lib/utils";
import { useArchivedTasks, useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask } from "@/types";
import { ExportMenu } from "@/components/features/ExportMenu";
import { ArchiveCleanupModal } from "./ArchiveCleanupModal";

type SortOption = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

export function ArchiveView() {
  const archivedTasks = useArchivedTasks();
  const removeTask = useTasks((s) => s.removeTask);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("date-desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);

  const getArchivedSize = (task: TranscriptionTask): number => task.archiveSize ?? task.fileSize;

  const filteredAndSortedTasks = useMemo(() => {
    let result = [...archivedTasks];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((task) =>
        task.fileName.toLowerCase().includes(query)
      );
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      result = result.filter((task) => new Date(task.createdAt) >= fromDate);
    }
    if (dateTo) {
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
  }, [archivedTasks, searchQuery, sortOption, dateFrom, dateTo]);

  const totalArchivedSize = useMemo(
    () => archivedTasks.reduce((sum, task) => sum + getArchivedSize(task), 0),
    [archivedTasks]
  );

  // Пагинация
  const totalPages = Math.ceil(filteredAndSortedTasks.length / itemsPerPage);
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedTasks.slice(start, start + itemsPerPage);
  }, [filteredAndSortedTasks, currentPage, itemsPerPage]);

  // Сброс страницы при изменении фильтров
  const handleFilterChange = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setCurrentPage(1);
  };

  const handleTaskClick = (taskId: string) => {
    setSelectedTask(taskId);
    setCurrentView("transcription");
  };

  if (archivedTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Archive className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Архив пуст</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Архивированные транскрипции будут появляться здесь. Нажмите на иконку архива
          рядом с результатом транскрипции, чтобы переместить её в архив.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 overflow-y-auto h-full">
      {/* Заголовок и количество */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            {filteredAndSortedTasks.length.toLocaleString()} видео в архиве
          </p>
          <p className="text-sm text-muted-foreground">
            Занимают на устройстве: <span className="font-medium text-foreground">{formatFileSize(totalArchivedSize)}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCleanupModalOpen(true)}
          className="gap-1.5"
        >
          <Sparkles className="h-4 w-4" />
          Почистить
        </Button>
      </div>

      {/* Панель фильтров и сортировки */}
      <div className="flex flex-col gap-3 p-3 bg-muted/50 rounded-lg">
        {/* Поиск */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Поиск по названию..."
            value={searchQuery}
            onChange={(e) => handleFilterChange(setSearchQuery)(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {searchQuery && (
            <button
              onClick={() => handleFilterChange(setSearchQuery)("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Фильтры по дате и сортировка */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Фильтр по дате от */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
              className="w-[130px] px-2 py-1.5 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              title="С даты"
            />
          </div>

          {/* Фильтр по дате до */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
              className="w-[130px] px-2 py-1.5 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              title="По дату"
            />
          </div>

          {/* Сортировка */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              value={sortOption}
              onChange={(e) => {
                setSortOption(e.target.value as SortOption);
                setCurrentPage(1);
              }}
              className="h-8 px-2 py-1 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-auto min-w-[180px]"
            >
              <option value="date-desc">Сначала новые</option>
              <option value="date-asc">Сначала старые</option>
              <option value="name-asc">По названию А→Я</option>
              <option value="name-desc">По названию Я→А</option>
            </select>
          </div>
        </div>
      </div>

      {/* Таблица архивированных задач */}
      <div className="border rounded-lg overflow-hidden bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Файл</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground w-24">Размер</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground w-36">Дата</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground w-24">Действия</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTasks.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                  Ничего не найдено по заданным фильтрам
                </td>
              </tr>
            ) : (
              paginatedTasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => handleTaskClick(task.id)}
                >
                  <td className="py-3 px-4">
                    <span className="font-medium truncate max-w-[250px] sm:max-w-[350px] lg:max-w-[450px]" title={task.fileName}>
                      {task.fileName}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                    {formatFileSize(getArchivedSize(task))}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                    {formatDateTime(task.createdAt)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <ExportMenu task={task} iconOnly />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTask(task.id);
                        }}
                        title="Удалить"
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

      {/* Пагинация */}
      {filteredAndSortedTasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          {/* Количество элементов на странице */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Показывать:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-8 px-2 py-1 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {ITEMS_PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span>на странице</span>
          </div>

          {/* Навигация по страницам */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <span className="text-sm text-muted-foreground px-2">
              {currentPage} из {totalPages || 1}
            </span>

            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Информация о записях */}
          <div className="text-sm text-muted-foreground">
            {filteredAndSortedTasks.length > 0 && (
              <>
                {(currentPage - 1) * itemsPerPage + 1}–
                {Math.min(currentPage * itemsPerPage, filteredAndSortedTasks.length)} из{" "}
                {filteredAndSortedTasks.length}
              </>
            )}
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
