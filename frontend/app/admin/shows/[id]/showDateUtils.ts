export interface ShowDateOption {
  value: string;
  label: string;
}

export function getShowDates(startDate: string, endDate: string): ShowDateOption[] {
  const dates: ShowDateOption[] = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const end = new Date(ey, em - 1, ed);

  for (let d = new Date(sy, sm - 1, sd); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push({
      value: `${y}-${m}-${day}`,
      label: new Date(y, d.getMonth(), d.getDate()).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      }),
    });
  }
  return dates;
}
