# Release Prompt

Commit, push, and release a new version of memory-mcp.

## Steps

1. **Stage all changes**
   ```bash
   git add -A
   ```

2. **Generate commit message** following Conventional Commits:
   - `feat:` for new features (bumps minor version)
   - `fix:` for bug fixes (bumps patch version)
   - `feat!:` or `fix!:` for breaking changes (bumps major version)

3. **Commit changes**
   ```bash
   git commit -m "<type>: <description>"
   ```

4. **Push to main**
   ```bash
   git push origin main
   ```

5. **Bump version based on commit type**
   ```bash
   # For feat: (new feature)
   npm version minor -m "chore(release): %s"
   
   # For fix: (bug fix)
   npm version patch -m "chore(release): %s"
   
   # For breaking changes
   npm version major -m "chore(release): %s"
   ```

6. **Push tags**
   ```bash
   git push origin main --tags
   ```

7. **Publish to npm** (optional)
   ```bash
   npm publish --access public
   ```

## Notes

- Always review `git status` and `git diff` before committing
- Ensure the build passes with `npm run build` before releasing
- Version is automatically updated in package.json by `npm version`
