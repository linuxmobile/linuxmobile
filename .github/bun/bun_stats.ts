#!/usr/bin/env bun
import { file } from "bun";
import { config } from "./config";

const token = process.env.TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is missing!");
  process.exit(1);
}

const username = config.username;

const now = new Date();
const currentYearStart = new Date(now.getFullYear(), 0, 1).toISOString();
const currentYearEnd = now.toISOString();
const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString();
const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31).toISOString();

const pinnedReposQuery = config.pinned
  .map(
    (repo, index) => `
  repo${index}: repository(owner: $username, name: "${repo.name}") {
    name
    description
    stargazerCount
    primaryLanguage {
      name
      color
    }
    watchers {
      totalCount
    }
    url
  }
`,
  )
  .join("\n");

const query = `
  query($username: String!, $currentYearStart: DateTime!, $currentYearEnd: DateTime!, $lastYearStart: DateTime!, $lastYearEnd: DateTime!) {
    user(login: $username) {
      name
      bio
      followers {
        totalCount
      }
      issues(states: OPEN) {
        totalCount
      }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {field: STARGAZERS, direction: DESC}) {
        totalCount
        nodes {
          name
          stargazerCount
          primaryLanguage {
            name
            color
          }
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
      currentYear: contributionsCollection(from: $currentYearStart, to: $currentYearEnd) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              date
              weekday
            }
          }
        }
        commitContributionsByRepository(maxRepositories: 100) {
          repository {
            name
            primaryLanguage {
              name
            }
          }
          contributions(first: 100) {
            nodes {
              occurredAt
              commitCount
            }
          }
        }
      }
      lastYear: contributionsCollection(from: $lastYearStart, to: $lastYearEnd) {
        contributionCalendar {
          totalContributions
        }
      }
    }
    ${pinnedReposQuery}
  }
`;

function getActivityType(language: string | null): string {
  if (!language) return "general development";
  const map: Record<string, string> = {
    Rust: "systems programming",
    Go: "backend services",
    TypeScript: "application development",
    JavaScript: "interactive interfaces",
    Python: "data processing",
    Lua: "configuration & scripting",
    Nix: "reproducible infrastructure",
    HTML: "structure & layout",
    CSS: "visual styling",
    "C++": "performance engineering",
    C: "low-level system logic",
    Shell: "automation scripts",
  };
  return map[language] || "coding activity";
}

async function fetchData(username: string) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        username,
        currentYearStart,
        currentYearEnd,
        lastYearStart,
        lastYearEnd,
      },
    }),
  });

  const data = await response.json();
  if (data.errors) {
    console.error("GraphQL Error:", JSON.stringify(data.errors, null, 2));
    process.exit(1);
  }
  return data.data;
}

export async function generateStats() {
  const data = await fetchData(username);
  const user = data.user;

  let totalStars = 0;
  user.repositories.nodes.forEach((repo: any) => {
    totalStars += repo.stargazerCount;
  });

  const hero = {
    total_repos: user.repositories.totalCount,
    total_stars: totalStars,
    total_followers: user.followers.totalCount,
    total_issues: user.issues.totalCount,
  };

  const pinned = config.pinned
    .map((configRepo, index) => {
      const repo = data[`repo${index}`];
      if (!repo) return null;
      return {
        title: repo.name,
        description: repo.description,
        language: repo.primaryLanguage?.name || "N/A",
        language_color: repo.primaryLanguage?.color || "#ccc",
        stars: repo.stargazerCount,
        watches: repo.watchers.totalCount,
        url: repo.url,
        topic: configRepo.topic,
      };
    })
    .filter(Boolean);

  const languageStats: Record<string, { size: number; color: string }> = {};
  let totalSize = 0;

  user.repositories.nodes.forEach((repo: any) => {
    if (repo.languages && repo.languages.edges) {
      repo.languages.edges.forEach((edge: any) => {
        const { size, node } = edge;
        const { name, color } = node;
        if (!languageStats[name]) {
          languageStats[name] = { size: 0, color };
        }
        languageStats[name].size += size;
        totalSize += size;
      });
    }
  });

  const languages = Object.entries(languageStats)
    .map(([name, { size, color }]) => ({
      name,
      percent: Math.round((size / totalSize) * 100),
      color,
    }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);

  const mostUsedLanguage = languages.length > 0 ? languages[0] : null;

  const currentCalendar = user.currentYear.contributionCalendar;
  const lastYearTotal = user.lastYear.contributionCalendar.totalContributions;
  const currentTotal = currentCalendar.totalContributions;

  let growthRaw = 0;
  if (lastYearTotal > 0) {
    growthRaw = ((currentTotal - lastYearTotal) / lastYearTotal) * 100;
  }
  const growth = growthRaw.toFixed(1) + "%";

  const days = currentCalendar.weeks.flatMap((w: any) => w.contributionDays);

  const todayStr = new Date().toISOString().split("T")[0];
  let todayIndex = days.findIndex((d: any) => d.date === todayStr);
  if (todayIndex === -1) todayIndex = days.length - 1;

  let currentStreak = 0;
  for (let i = todayIndex; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      currentStreak++;
    } else if (i === todayIndex && days[i].contributionCount === 0) {
      continue;
    } else {
      break;
    }
  }

  let peakDay = { date: "", contributionCount: 0 };
  const sortedDays = [...days].sort(
    (a: any, b: any) => b.contributionCount - a.contributionCount,
  );
  if (sortedDays.length > 0) {
    peakDay = sortedDays[0];
  }

  const top3Days = sortedDays.slice(0, 3).map((d: any) => ({
    date: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    count: d.contributionCount,
  }));

  const currentMonthIdx = new Date().getMonth();
  const currentDays = days.filter(
    (d: any) => new Date(d.date).getMonth() === currentMonthIdx,
  );

  const dayCounts: Record<number, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  };
  currentDays.forEach((d: any) => {
    dayCounts[d.weekday] += d.contributionCount;
  });

  const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  let bestDay = daysOfWeek[new Date().getDay()];
  let maxCount = -1;
  Object.keys(dayCounts).forEach((key) => {
    const dayIdx = Number(key);
    if (dayCounts[dayIdx] > maxCount) {
      maxCount = dayCounts[dayIdx];
      bestDay = daysOfWeek[dayIdx];
    }
  });

  const repoCounts: Record<string, number> = {};
  const repoLanguages: Record<string, string> = {};

  if (user.currentYear.commitContributionsByRepository) {
    user.currentYear.commitContributionsByRepository.forEach(
      (repoContrib: any) => {
        const repoName = repoContrib.repository.name;
        const lang = repoContrib.repository.primaryLanguage?.name || null;
        if (lang) repoLanguages[repoName] = lang;

        repoContrib.contributions.nodes.forEach((node: any) => {
          const date = new Date(node.occurredAt);
          if (date.getMonth() === currentMonthIdx) {
            repoCounts[repoName] =
              (repoCounts[repoName] || 0) + node.commitCount;
          }
        });
      },
    );
  }

  const focusSorted = Object.entries(repoCounts).sort((a, b) => b[1] - a[1]);
  const monthlyFocus = focusSorted.length > 0 ? focusSorted[0][0] : "Research";

  let monthlyFocusHtml = "Structuring <b>ideas</b> into reality.";
  if (focusSorted.length > 0) {
    const topRepo = focusSorted[0][0];
    const topLang = repoLanguages[topRepo] || "Code";
    const activityType = getActivityType(topLang);
    const monthName = new Date().toLocaleString("default", { month: "long" });

    monthlyFocusHtml = `${monthName} saw a significant shift towards ${activityType}, with heavy activity in <span class="text-accent font-medium">${topLang}</span> configurations for the <span class="text-accent font-medium">${topRepo}</span> setup.`;
  }

  const chronicle = {
    total_contribution_volume: currentTotal,
    growth_percentage: growth,
    most_used_language: mostUsedLanguage,
    current_streak: currentStreak,
    peak_activity_day: {
      date: new Date(peakDay.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      count: peakDay.contributionCount,
    },
    top_activities: top3Days,
    monthly_focus: monthlyFocus,
    monthly_focus_html: monthlyFocusHtml,
    most_productive_day: bestDay,
    languages: languages,
    stack: config.chronicle.stack,
    stats: {
      timeline: days.map((d: any) => ({
        date: d.date,
        count: d.contributionCount,
      })),
    },
  };

  return {
    hero,
    pinned,
    chronicle,
  };
}

if (import.meta.main) {
  const output = await generateStats();
  const jsonOutput = JSON.stringify(output, null, 2);
  await Bun.write(".github/bun/data.json", jsonOutput);
  console.log(jsonOutput);
}
