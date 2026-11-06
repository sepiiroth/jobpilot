FROM postgres:18.6-alpine3.24 AS vector-build
ARG PGVECTOR_VERSION=0.8.7
ARG PGVECTOR_SHA256=cf09c09624f7fc9eb31560e48539799ee516030d89b22155c36f3cc2a86fc452
RUN apk add --no-cache --virtual .vector-build-deps build-base curl unzip
RUN curl --fail --location --proto '=https' --tlsv1.2 "https://api.pgxn.org/dist/vector/${PGVECTOR_VERSION}/vector-${PGVECTOR_VERSION}.zip" -o /tmp/vector.zip \
    && echo "${PGVECTOR_SHA256}  /tmp/vector.zip" | sha256sum -c - \
    && unzip -q /tmp/vector.zip -d /tmp \
    && cd "/tmp/vector-${PGVECTOR_VERSION}" \
    && make OPTFLAGS="" with_llvm=no \
    && make install OPTFLAGS="" with_llvm=no
FROM postgres:18.6-alpine3.24 AS runtime
# Use Alpine's maintained privilege dropper instead of the bundled Go binary.
RUN apk upgrade --no-cache \
    && apk add --no-cache su-exec=0.3-r0 \
    && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh \
    && ! grep -q gosu /usr/local/bin/docker-entrypoint.sh \
    && rm /usr/local/bin/gosu \
    && su-exec postgres test "$(id -u postgres)" -ne 0
COPY --from=vector-build /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/vector.so
COPY --from=vector-build /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
COPY --from=vector-build /tmp/vector-*/LICENSE /usr/share/licenses/pgvector/LICENSE
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 CMD pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"
