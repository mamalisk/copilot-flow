# Skills

<!--
  This directory contains SKILL.md files that agents can invoke as tools.
  Each skill file describes a repeatable procedure the agent can follow.

  Format: each file should have a YAML frontmatter block followed by markdown body.

  Example — .github/skills/deploy-staging/SKILL.md:
  ---
  name: deploy-staging
  description: Deploy the current branch to the staging environment
  ---
  1. Run: npm run build
  2. Run: npm run deploy:staging
  3. Verify at https://staging.example.com
  4. Post result to #deployments Slack channel

  Register skill directories with:
    copilot-flow exec plan.yaml --skill-dir .github/skills
-->
