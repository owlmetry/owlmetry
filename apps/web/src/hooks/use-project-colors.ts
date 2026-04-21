import { useMemo } from "react";
import useSWR from "swr";
import type { ProjectResponse, AppResponse } from "@owlmetry/shared";

export function useProjectInfoMap(
  teamId: string | null | undefined,
): Map<string, { name: string; color: string }> {
  const { data } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  return useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const p of data?.projects ?? []) m.set(p.id, { name: p.name, color: p.color });
    return m;
  }, [data]);
}

export function useProjectColorMap(teamId: string | null | undefined): Map<string, string> {
  const infoMap = useProjectInfoMap(teamId);
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, info] of infoMap) m.set(id, info.color);
    return m;
  }, [infoMap]);
}

export function useAppColorMap(teamId: string | null | undefined): Map<string, string> {
  const projectColorMap = useProjectColorMap(teamId);
  const { data } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null,
  );
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const a of data?.apps ?? []) m.set(a.id, projectColorMap.get(a.project_id) ?? "");
    return m;
  }, [data, projectColorMap]);
}
